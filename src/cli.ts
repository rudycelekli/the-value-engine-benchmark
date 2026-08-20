#!/usr/bin/env node
/**
 * The Value Engine Benchmark CLI.
 *
 *   npm run bench -- --scenario logistics-saas --seller anthropic:claude-sonnet-4-6 [--pack] [--mock]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, listScenarios } from './engine/scenario.js';
import { runEpisode } from './engine/runner.js';
import { createSeller } from './seller/index.js';
import { gradeEpisode } from './grading/judge.js';
import { writeGradeReport } from './grading/report.js';
import { runSuite } from './suite.js';
import { verifyScenario, type BuyerMode } from './env/verifier.js';
import { runRewardHackAudit } from './env/audit.js';
import { packageDataset } from './env/dataset.js';
import { buildEnvEvidence, FLAGSHIP_SCENARIOS } from './env/evidence.js';
import { runDifficultyGate } from './env/gate.js';
import { buildHarborPackage } from './env/harbor.js';
import { runRolloutSuite } from './env/rollout-suite.js';
import { resolveSellers } from './models.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string | boolean> } {
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'bench';
  const flags = new Map<string, string | boolean>();
  for (let i = cmd === argv[0] ? 1 : 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { cmd, flags };
}

function usage(): never {
  console.log(`The Value Engine Benchmark

Usage:
  npm run bench -- --scenario <id|path> --seller <spec> [--pack] [--mock] [--verbose]
                   [--scenario-dir <dir>] [--runs <dir>]
  npm run calibrate -- --scenario <id|path> [--scenario-dir <dir>] [--mock]
  npm run suite -- --scenarios <ids|glob|dir|all|generated> --sellers <spec|frontier>
                   [--tracks both|oob|pack] [--concurrency 4] [--mock] [--seed <n>]
                   [--resume <suite-dir>] [--max-cost-usd <n>] [--label <name>]
  node dist/cli.js scenarios [--scenario-dir <dir>]
  npm run build && node dist/cli.js env verify --scenario <id|path> --seller <spec> [--out <dir>] [--mock]
                   [--buyer-mode live|record|replay] [--transcript-dir <dir>]
  node dist/cli.js env gate  --scenario <id|path>
  node dist/cli.js env audit --scenario <id|path>
  node dist/cli.js env build --scenario <id|path> --out <dir>
  node dist/cli.js env dataset --scenario <id|path> --out <dir>
  node dist/cli.js env evidence --out <path> [--scenarios <id,id,...>]
  node dist/cli.js env rollout --scenarios <ids> --sellers <frontier|spec,...> --seeds <n|list> --budget <usd> --out <dir> [--concurrency <n>] [--pack] [--mock] [--resume]

Seller specs: anthropic:<model> · openai:<model> · xai:<model> · gemini:<model>
              · scripted-baseline · scripted-disciplined · frontier (suite: top-2 per provider)
Flags:
  --pack     prepend the Value Engine system prompt (out-of-box vs +pack track)
  --mock     offline mode: scripted-but-reactive buyer + heuristic judge (no API keys)

calibrate: runs the naive scripted-baseline (must NOT win) and the disciplined
reference seller against a scenario and reports pass/fail. With
PORTKEY_API_KEY set (and no --mock), the reference seller is
anthropic:claude-sonnet-4-6 +pack against the LLM buyer.
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const scenarioDir = String(flags.get('scenario-dir') ?? join(ROOT, 'scenarios'));
  const runsDir = String(flags.get('runs') ?? join(ROOT, 'runs'));

  if (cmd === 'scenarios') {
    for (const s of listScenarios(scenarioDir)) {
      console.log(`- ${s.id} (difficulty ${s.difficulty}): ${s.name}`);
    }
    return;
  }

  if (cmd === 'calibrate') {
    const scenarioId = flags.get('scenario');
    if (typeof scenarioId !== 'string') usage();
    const mock = Boolean(flags.get('mock')) || !process.env.PORTKEY_API_KEY;
    const scenario = loadScenario(scenarioId, scenarioDir);
    console.log(`\n▶ Calibrating ${scenario.id} (difficulty ${scenario.difficulty}, ${scenario.calendar.weeks}wk, ${scenario.personas.length} personas)\n`);

    const base = await runEpisode({ scenario, seller: createSeller('scripted-baseline', false), pack: false, mock: true, runsDir, noPersist: true });
    const basePass = base.episode.outcome !== 'won';
    console.log(`  Floor  — scripted-baseline (mock buyer):   ${base.episode.outcome}  → ${basePass ? 'PASS (did not win)' : 'FAIL (naive seller won)'}`);

    const refSpec = mock ? 'scripted-disciplined' : 'anthropic:claude-sonnet-4-6';
    const ref = await runEpisode({ scenario, seller: createSeller(refSpec, !mock), pack: !mock, mock, runsDir, noPersist: true });
    const refReport = await gradeEpisode(ref.episode, scenario);
    const refPass = mock ? ref.episode.outcome === 'won' : ref.episode.outcome === 'won' || refReport.dvi.total >= 70;
    console.log(`  Ceiling — ${refSpec}${mock ? ' (mock buyer)' : ' +pack (LLM buyer)'}: ${ref.episode.outcome}, DVI ${refReport.dvi.total}  → ${refPass ? 'PASS' : 'FAIL (reference seller could not win / weak DVI)'}`);

    console.log(`\nCalibration: ${basePass && refPass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!(basePass && refPass)) process.exitCode = 2;
    return;
  }

  if (cmd === 'env') {
    const sub = process.argv.slice(2)[1];

    if (sub === 'evidence') {
      const out = flags.get('out');
      if (typeof out !== 'string') usage();
      const ids = flags.has('scenarios')
        ? String(flags.get('scenarios')).split(',').map((s) => s.trim()).filter(Boolean)
        : FLAGSHIP_SCENARIOS;
      const scenarios = ids.map((id) => loadScenario(id, scenarioDir));
      const evidence = await buildEnvEvidence(scenarios, runsDir, new Date().toISOString());
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      console.log(`\n▶ Env evidence → ${out} (${evidence.scenarios.length} scenarios, buyer_sim=${evidence.buyer_sim})`);
      for (const s of evidence.scenarios) {
        console.log(`  ${s.gate.pass ? '✓' : '✗'} ${s.scenario_id.padEnd(20)} gate: oracle=${s.gate.oracle} floor=${s.gate.floor} · audit worst=${s.audit.worstReward} ${s.audit.pass ? '✓' : '✗'}`);
      }
      return;
    }

    if (sub === 'rollout') {
      const out = flags.get('out');
      if (typeof out !== 'string') usage();
      const scenarioIds = String(flags.get('scenarios') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (scenarioIds.length === 0) usage();
      const sellers = resolveSellers(String(flags.get('sellers') ?? 'frontier'));
      const seedsFlag = String(flags.get('seeds') ?? '1');
      const seeds = seedsFlag.includes(',')
        ? seedsFlag.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
        : Array.from({ length: Math.max(1, Number(seedsFlag) || 1) }, (_, i) => i + 1);
      const budget = Number(flags.get('budget') ?? '0');
      const pack = flags.has('pack');
      const mock = flags.has('mock');
      const resume = flags.has('resume');
      const concurrency = Math.max(1, Number(flags.get('concurrency') ?? '1') || 1);

      const scenarios = scenarioIds.map((id) => loadScenario(id, scenarioDir));
      mkdirSync(out, { recursive: true });
      const report = await runRolloutSuite({
        scenarios,
        sellerSpecs: sellers,
        seeds,
        pack,
        runsDir,
        budgetUsd: budget,
        datasetPath: `${out}/dataset.jsonl`,
        transcriptRoot: `${out}/transcripts`,
        reportPath: `${out}/rollout-report.json`,
        mock,
        concurrency,
        resume,
      });

      writeFileSync(`${out}/rollout-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

      console.log(`\n▶ Rollout suite → ${out}`);
      console.log(
        `  datapoints=${report.datapoints}  errored=${report.errored}  spent=$${report.spent_usd}/${report.budget_usd}` +
          `${report.stopped_on_budget ? '  (STOPPED on budget)' : ''}`,
      );
      if (report.errored > 0) {
        console.log('  errored cells (skipped, safe to re-run):');
        for (const e of report.errors) {
          console.log(`    ${`${e.env}·${e.model}·s${e.seed}`.padEnd(48)} ${e.attempts} attempt(s): ${e.error}`);
        }
      }
      console.log('  leaderboard (mean reward · clear-rate):');
      for (const r of report.leaderboard) {
        console.log(
          `    ${r.model.padEnd(34)} ${r.mean_reward.toFixed(3)}  clear=${(r.clear_rate * 100).toFixed(0)}%  $${r.total_cost_usd}`,
        );
      }
      console.log('  env difficulty:');
      for (const e of report.env_difficulty) {
        console.log(
          `    ${e.env.padEnd(24)} best=${e.best_reward.toFixed(3)}  ${e.empirically_solved ? `solved by ${e.solved_by.length}` : 'UNSOLVED'}`,
        );
      }
      return;
    }

    const scenarioId = flags.get('scenario');
    if (typeof scenarioId !== 'string') usage();
    const scenario = loadScenario(scenarioId, scenarioDir);

    if (sub === 'verify') {
      const sellerSpec = typeof flags.get('seller') === 'string' ? (flags.get('seller') as string) : 'scripted-disciplined';
      const mock = Boolean(flags.get('mock')) || !process.env.PORTKEY_API_KEY;
      const outDir = typeof flags.get('out') === 'string' ? (flags.get('out') as string) : undefined;
      const buyerMode = (typeof flags.get('buyer-mode') === 'string' ? (flags.get('buyer-mode') as string) : 'live') as BuyerMode;
      const transcriptDir = typeof flags.get('transcript-dir') === 'string' ? (flags.get('transcript-dir') as string) : undefined;
      if ((buyerMode === 'record' || buyerMode === 'replay') && !transcriptDir) usage();
      const { result } = await verifyScenario({ scenario, sellerSpec, pack: false, mock, runsDir, outDir, buyerMode, transcriptDir });
      const froze = buyerMode !== 'live' ? ` buyer=${buyerMode}→${transcriptDir}` : '';
      console.log(`reward=${result.reward} resolved=${result.resolved} seller=${sellerSpec} checksum=${result.provenance.taskChecksum.slice(0, 12)}${froze}`);
      return;
    }
    if (sub === 'gate') {
      const report = await runDifficultyGate(scenario, runsDir);
      console.log(`\n▶ Difficulty gate ${report.scenarioId}: oracle=${report.oracleReward} floor=${report.floorReward}`);
      console.log(`  ${report.pass ? 'PASS ✓' : 'FAIL ✗'} (oracle≥0.9 ${report.oraclePass ? '✓' : '✗'} · floor<0.5 ${report.floorPass ? '✓' : '✗'})`);
      if (!report.pass) process.exitCode = 2;
      return;
    }
    if (sub === 'build') {
      const out = flags.get('out');
      if (typeof out !== 'string') usage();
      const written = buildHarborPackage({ scenario, outDir: out });
      console.log(`Harbor package → ${out}/${scenario.id} (${written.length} files)`);
      return;
    }
    if (sub === 'audit') {
      const report = await runRewardHackAudit(scenario, runsDir);
      console.log(`\n▶ Reward-hack audit ${report.scenarioId}: ${report.pass ? 'PASS ✓' : 'FAIL ✗'} (worst exploit reward=${report.worstReward}, ceiling=${report.ceiling})`);
      for (const e of report.exploits) {
        const crit = e.criticalFailures.length ? ` veto=[${e.criticalFailures.join(',')}]` : '';
        console.log(`  ${e.defeated ? '✓' : '✗'} ${e.id.padEnd(18)} reward=${e.reward} resolved=${e.resolved}${crit}`);
      }
      if (!report.pass) process.exitCode = 2;
      return;
    }
    if (sub === 'dataset') {
      const out = flags.get('out');
      if (typeof out !== 'string') usage();
      const card = await packageDataset({ scenario, runsDir, outDir: out });
      console.log(`\n▶ RLVR dataset ${card.scenario_id} → ${out}/dataset.jsonl (${card.count} rollouts)`);
      console.log(`  buyer_sim=${card.task.buyer_sim} task_checksum=${card.task.task_checksum.slice(0, 12)}… reward min=${card.reward.min} mean=${card.reward.mean} max=${card.reward.max}`);
      for (const p of card.reward.by_policy) console.log(`    ${p.id.padEnd(22)} reward=${p.value}`);
      console.log(`  sha256(jsonl)=${card.jsonl_sha256.slice(0, 16)}…`);
      return;
    }
    usage();
  }

  if (cmd === 'suite') {
    const resumeDir = flags.has('resume') ? String(flags.get('resume')) : undefined;
    const scenariosSpec = String(flags.get('scenarios') ?? 'all');
    const sellersSpec = String(flags.get('sellers') ?? 'frontier');
    const tracksRaw = String(flags.get('tracks') ?? 'both');
    if (!['both', 'oob', 'pack'].includes(tracksRaw)) usage();
    const concurrency = Number(flags.get('concurrency') ?? 4);
    if (!Number.isFinite(concurrency) || concurrency < 1) usage();
    await runSuite({
      scenariosSpec,
      sellersSpec,
      tracks: tracksRaw as 'both' | 'oob' | 'pack',
      concurrency,
      mock: Boolean(flags.get('mock')),
      seed: flags.has('seed') ? Number(flags.get('seed')) : undefined,
      resumeDir,
      maxCostUsd: flags.has('max-cost-usd') ? Number(flags.get('max-cost-usd')) : undefined,
      label: flags.has('label') ? String(flags.get('label')) : undefined,
      scenarioDir,
      suitesRoot: join(runsDir, 'suites'),
      verbose: Boolean(flags.get('verbose')),
    });
    return;
  }

  if (cmd !== 'bench') usage();
  const scenarioId = flags.get('scenario');
  const sellerSpec = flags.get('seller');
  if (typeof scenarioId !== 'string' || typeof sellerSpec !== 'string') usage();

  const pack = Boolean(flags.get('pack'));
  const mock = Boolean(flags.get('mock'));
  const verbose = Boolean(flags.get('verbose'));

  const scenario = loadScenario(scenarioId, scenarioDir);
  const seller = createSeller(sellerSpec, pack);
  mkdirSync(runsDir, { recursive: true });

  console.log(`\n▶ ${scenario.name} (difficulty ${scenario.difficulty})`);
  console.log(`  Seller: ${seller.id} · pack: ${pack} · mock: ${mock}\n`);

  const { episode, runDir } = await runEpisode({ scenario, seller, pack, mock, runsDir, verbose });
  console.log(`Episode finished: ${episode.outcome} (${episode.turns.length} turns) → ${runDir}`);

  const report = await gradeEpisode(episode, scenario);
  writeGradeReport(runDir, report);

  console.log(`\n=== GRADE ===`);
  console.log(`Sale Quality Score: ${report.saleQualityScore} / 100`);
  console.log(`DVI:                ${report.dvi.total} / 100 — ${report.dvi.band}`);
  console.log(`Outcome:            ${report.outcome}`);
  console.log(`Lowest letter:      ${report.dvi.lowestLetter} (${report.dvi.lowestLetterScore})`);
  console.log(`Price integrity:    ${report.priceIntegrity.score} (${report.priceIntegrity.discountGivenPct}% conceded)`);
  console.log(`Judge:              ${report.judge}`);
  console.log(`\nFull report: ${join(runDir, 'grade.md')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
