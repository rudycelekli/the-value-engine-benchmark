/**
 * Suite runner — a matrix of {scenarios × sellers × tracks} with:
 *   - a per-suite manifest.json updated atomically after every episode
 *     (so `--resume <suite-dir>` skips completed cells);
 *   - bounded concurrency (worker pool);
 *   - cost tracking from real provider token usage (seller-side) and a
 *     `--max-cost-usd` circuit breaker that stops SCHEDULING new episodes;
 *   - graceful skipping of sellers whose provider API key is missing;
 *   - a leaderboard over the suite dir when the matrix completes.
 *
 * Reuses the existing episode runner + grading via their exported APIs.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Scenario } from './types.js';
import { listScenarios, loadScenario } from './engine/scenario.js';
import { runEpisode } from './engine/runner.js';
import { createSeller } from './seller/index.js';
import { withUsageScope } from './seller/providers.js';
import { gradeEpisode } from './grading/judge.js';
import { writeGradeReport, aggregateRuns } from './grading/report.js';
import { PROVIDER_ENV, costOfUsage, providerOfSpec, resolveSellers } from './models.js';

export type Track = 'oob' | 'pack';
export type CellStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface SuiteCell {
  /** `scenario|seller|track` — stable across resumes. */
  id: string;
  scenarioId: string;
  seller: string;
  track: Track;
  status: CellStatus;
  runDir?: string;
  outcome?: string;
  sqs?: number;
  dvi?: number;
  costUsd?: number;
  error?: string;
}

export interface SuiteManifest {
  createdAt: string;
  updatedAt: string;
  label: string;
  mock: boolean;
  seed?: number;
  scenarioDir: string;
  scenarios: string[];
  sellers: string[];
  tracks: Track[];
  /** Estimated $ spend so far (seller-side token usage × registry prices). */
  totalCostUsd: number;
  cells: SuiteCell[];
}

export interface SuiteOptions {
  /** `all` | `generated` | dir | glob | comma list of ids (mixable). */
  scenariosSpec: string;
  /** `frontier` | comma list of seller specs. */
  sellersSpec: string;
  tracks: 'both' | Track;
  concurrency: number;
  mock: boolean;
  seed?: number;
  /** Existing suite dir to resume — completed cells are skipped. */
  resumeDir?: string;
  /** Stop scheduling new episodes once estimated spend crosses this. */
  maxCostUsd?: number;
  label?: string;
  scenarioDir: string;
  /** Root under which new suite dirs are created (e.g. runs/suites). */
  suitesRoot: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Scenario resolution
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Resolve a `--scenarios` spec into loaded scenarios, keyed by id. */
export function resolveScenarios(spec: string, scenarioDir: string): Map<string, Scenario> {
  const out = new Map<string, Scenario>();
  const add = (s: Scenario) => { if (!out.has(s.id)) out.set(s.id, s); };
  const generatedDir = join(scenarioDir, 'generated');

  for (const token of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (token === 'all') {
      for (const s of listScenarios(scenarioDir)) add(s);
    } else if (token === 'generated') {
      if (!existsSync(generatedDir)) throw new Error(`No generated scenarios at ${generatedDir}`);
      for (const s of listScenarios(generatedDir)) add(s);
    } else if (existsSync(token) && statSync(token).isDirectory()) {
      for (const s of listScenarios(resolve(token))) add(s);
    } else if (token.includes('*') || token.includes('?')) {
      const re = globToRegExp(token);
      const pool = [
        ...listScenarios(scenarioDir),
        ...(existsSync(generatedDir) ? listScenarios(generatedDir) : []),
      ];
      const matched = pool.filter((s) => re.test(s.id));
      if (!matched.length) throw new Error(`Glob '${token}' matched no scenarios in ${scenarioDir}`);
      for (const s of matched) add(s);
    } else {
      // A single id (or yaml path) — try the main dir, then generated/.
      try {
        add(loadScenario(token, scenarioDir));
      } catch (err) {
        if (existsSync(generatedDir)) add(loadScenario(token, generatedDir));
        else throw err;
      }
    }
  }
  if (!out.size) throw new Error(`--scenarios '${spec}' resolved to nothing`);
  return out;
}

// ---------------------------------------------------------------------------
// Manifest persistence (atomic)
// ---------------------------------------------------------------------------

function saveManifest(suiteDir: string, manifest: SuiteManifest): void {
  manifest.updatedAt = new Date().toISOString();
  const tmp = join(suiteDir, 'manifest.json.tmp');
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, join(suiteDir, 'manifest.json')); // atomic on POSIX
}

function loadManifest(suiteDir: string): SuiteManifest {
  const p = join(suiteDir, 'manifest.json');
  if (!existsSync(p)) throw new Error(`No manifest.json in ${suiteDir} — is this a suite directory?`);
  return JSON.parse(readFileSync(p, 'utf8')) as SuiteManifest;
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function runSuite(opts: SuiteOptions): Promise<{ suiteDir: string; manifest: SuiteManifest }> {
  let suiteDir: string;
  let manifest: SuiteManifest;

  if (opts.resumeDir) {
    suiteDir = resolve(opts.resumeDir);
    manifest = loadManifest(suiteDir);
    // Interrupted `running` (and previously `failed`) cells are retried.
    for (const c of manifest.cells) {
      if (c.status === 'running' || c.status === 'failed') c.status = 'pending';
    }
    console.log(`▶ Resuming suite ${suiteDir}`);
  } else {
    const tracks: Track[] = opts.tracks === 'both' ? ['oob', 'pack'] : [opts.tracks];
    const scenarios = resolveScenarios(opts.scenariosSpec, opts.scenarioDir);
    const sellers = resolveSellers(opts.sellersSpec);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const label = opts.label ?? opts.sellersSpec.replace(/[^a-zA-Z0-9._+-]/g, '_').slice(0, 40);
    suiteDir = join(opts.suitesRoot, `${stamp}-${label}`);
    mkdirSync(suiteDir, { recursive: true });

    const cells: SuiteCell[] = [];
    for (const scenarioId of scenarios.keys()) {
      for (const seller of sellers) {
        for (const track of tracks) {
          cells.push({ id: `${scenarioId}|${seller}|${track}`, scenarioId, seller, track, status: 'pending' });
        }
      }
    }
    manifest = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      label,
      mock: opts.mock,
      seed: opts.seed,
      scenarioDir: resolve(opts.scenarioDir),
      scenarios: [...scenarios.keys()],
      sellers,
      tracks,
      totalCostUsd: 0,
      cells,
    };
    console.log(`▶ New suite ${suiteDir} — ${scenarios.size} scenario(s) × ${sellers.length} seller(s) × ${tracks.length} track(s) = ${cells.length} cells`);
  }

  // Skip sellers whose provider key is missing — warn once per seller, never crash.
  const missingKeySellers = new Set<string>();
  for (const seller of manifest.sellers) {
    const provider = providerOfSpec(seller);
    if (provider && !process.env[PROVIDER_ENV[provider]]) missingKeySellers.add(seller);
  }
  for (const seller of missingKeySellers) {
    const env = PROVIDER_ENV[providerOfSpec(seller)!];
    console.warn(`⚠ Skipping seller '${seller}': ${env} is not set.`);
    for (const c of manifest.cells) {
      if (c.seller === seller && c.status === 'pending') {
        c.status = 'skipped';
        c.error = `${env} not set`;
      }
    }
  }

  // Pre-load every scenario the pending cells need (fail fast on bad ids).
  const scenariosById = new Map<string, Scenario>();
  for (const id of new Set(manifest.cells.filter((c) => c.status === 'pending').map((c) => c.scenarioId))) {
    try {
      scenariosById.set(id, loadScenario(id, manifest.scenarioDir));
    } catch {
      const gen = join(manifest.scenarioDir, 'generated');
      scenariosById.set(id, loadScenario(id, gen));
    }
  }

  saveManifest(suiteDir, manifest);

  const queue = manifest.cells.filter((c) => c.status === 'pending');
  const maxCost = opts.maxCostUsd ?? Infinity;
  let costCapHit = false;
  let queueIdx = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (manifest.totalCostUsd >= maxCost) {
        if (!costCapHit) {
          costCapHit = true;
          console.warn(`⚠ Estimated spend $${round4(manifest.totalCostUsd)} crossed --max-cost-usd ${maxCost} — no new episodes will be scheduled. Resume later with --resume ${suiteDir}.`);
        }
        return;
      }
      const cell = queue[queueIdx++];
      if (!cell) return;

      cell.status = 'running';
      saveManifest(suiteDir, manifest);
      console.log(`  ▷ [${manifest.cells.filter((c) => c.status === 'done').length}/${manifest.cells.length}] ${cell.id}`);

      try {
        const scenario = scenariosById.get(cell.scenarioId)!;
        const seller = createSeller(cell.seller, cell.track === 'pack');
        // Per-episode usage scope: token usage recorded by the seller adapters
        // inside this async context is attributed to this cell (buyer/judge
        // usage runs through src/llm.ts and is not counted — seller-side only).
        const { result, usage } = await withUsageScope(async () => {
          const run = await runEpisode({
            scenario,
            seller,
            pack: cell.track === 'pack',
            mock: opts.mock,
            runsDir: suiteDir,
            verbose: opts.verbose,
          });
          const report = await gradeEpisode(run.episode, scenario);
          writeGradeReport(run.runDir, report);
          return { run, report };
        });
        cell.status = 'done';
        cell.runDir = result.run.runDir;
        cell.outcome = result.run.episode.outcome;
        cell.sqs = result.report.saleQualityScore;
        cell.dvi = result.report.dvi.total;
        cell.costUsd = round4(costOfUsage(usage));
        manifest.totalCostUsd = round4(manifest.totalCostUsd + cell.costUsd);
        console.log(`  ✓ ${cell.id} — ${cell.outcome}, SQS ${cell.sqs}, DVI ${cell.dvi}${cell.costUsd ? `, ~$${cell.costUsd}` : ''}`);
      } catch (err) {
        cell.status = 'failed';
        cell.error = (err as Error).message?.slice(0, 500);
        console.error(`  ✗ ${cell.id} failed: ${cell.error}`);
      }
      saveManifest(suiteDir, manifest);
    }
  };

  const n = Math.max(1, Math.min(opts.concurrency, queue.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));

  // Leaderboard over this suite's run dirs (reuses the report aggregation).
  const table = aggregateRuns(suiteDir);
  writeFileSync(join(suiteDir, 'leaderboard.md'), table);

  const counts = manifest.cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nSuite ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')} · est. cost $${manifest.totalCostUsd}`,
  );
  console.log(`Manifest:    ${join(suiteDir, 'manifest.json')}`);
  console.log(`Leaderboard: ${join(suiteDir, 'leaderboard.md')}\n`);
  console.log(table);

  return { suiteDir, manifest };
}
