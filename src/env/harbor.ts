/**
 * Harbor task-package builder — emits one VEB scenario as a self-contained,
 * resettable Harbor/Terminal-Bench-2 task dir matching the standard task
 * anatomy: instruction.md + task.toml + environment/Dockerfile + seed data +
 * tests/ (verifier → reward.txt) + solution/solve.sh (oracle) + rubrics.txt.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { Scenario } from '../types.js';
import { buildEnvProvenance } from './provenance.js';

const NODE_IMAGE = 'node:20.18.1-slim';

export interface HarborPackageOptions {
  scenario: Scenario;
  outDir: string;
  generatedAt?: string;
}

export function buildHarborPackage(opts: HarborPackageOptions): string[] {
  const { scenario } = opts;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const prov = buildEnvProvenance(scenario, generatedAt);
  const root = join(opts.outDir, scenario.id);
  const written: string[] = [];

  const put = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    if (content.startsWith('#!')) chmodSync(abs, 0o755);
    written.push(rel);
  };

  const wc = scenario.win_conditions;

  put('instruction.md', [
    `# ${scenario.name}`,
    ``,
    `You are the **seller**. Run this enterprise deal end to end over ${scenario.calendar.weeks} weeks.`,
    ``,
    `## Brief`,
    scenario.seller_brief.trim(),
    ``,
    `## List price`,
    scenario.list_price,
    ``,
    `## What "winning" means`,
    wc.description.trim(),
    ``,
    `You succeed by earning the required disclosures through evidence-based discovery,`,
    `reaching and securing the economic buyer, building an acknowledged mutual action plan,`,
    `and defending price — not by pitching, pushing, or discounting.`,
  ].join('\n') + '\n');

  put('task.toml', [
    `# Auto-generated Harbor task package — do not edit by hand.`,
    `[metadata]`,
    `id = ${q(scenario.id)}`,
    `name = ${q(scenario.name)}`,
    `difficulty = ${scenario.difficulty}`,
    `weeks = ${scenario.calendar.weeks}`,
    `author = "Rudy M. Celekli"`,
    `generated_at = ${q(generatedAt)}`,
    ``,
    `[provenance]`,
    `git_sha = ${q(prov.git.sha)}`,
    `buyer_sim = ${q(prov.buyerSim)}`,
    `seed = ${prov.seed ?? -1}`,
    `task_checksum = ${q(prov.taskChecksum)}`,
    ``,
    `[resources]`,
    `cpus = 1`,
    `memory_mb = 1024`,
    `timeout_seconds = 1800`,
    ``,
    `[[milestones]]`,
    `id = "facts"`,
    `weight = 0.40`,
    `description = "Required facts earned via gated discovery"`,
    ``,
    `[[milestones]]`,
    `id = "trust"`,
    `weight = 0.20`,
    `description = ${q(`Trust >= ${wc.min_trust}`)}`,
    ``,
    `[[milestones]]`,
    `id = "eb"`,
    `weight = 0.15`,
    `description = ${q(`EB meeting: ${wc.requires_eb_meeting}`)}`,
    ``,
    `[[milestones]]`,
    `id = "map"`,
    `weight = 0.15`,
    `description = ${q(`MAP acknowledged: ${wc.requires_map}`)}`,
    ``,
    `[[milestones]]`,
    `id = "price"`,
    `weight = 0.10`,
    `description = ${q(`Discount <= ${wc.max_discount_pct}%`)}`,
  ].join('\n') + '\n');

  put('environment/Dockerfile', [
    `# Pinned, reproducible world for the VEB environment.`,
    `FROM ${NODE_IMAGE}`,
    `WORKDIR /app`,
    `COPY dist ./dist`,
    `COPY node_modules ./node_modules`,
    `COPY environment/task_file ./task_file`,
    `ENV BENCH_BUYER_MODEL=claude-sonnet-4-6`,
    `ENTRYPOINT ["bash"]`,
  ].join('\n') + '\n');

  put('environment/task_file/scenario.yaml', stringify(scenario));

  put('tests/test.sh', [
    `#!/usr/bin/env bash`,
    `# Milestone verifier → /logs/verifier/reward.txt (+ ctrf.json + result.json).`,
    `set -euo pipefail`,
    `mkdir -p /logs/verifier`,
    `node /app/dist/cli.js env verify \\`,
    `  --scenario /app/task_file/scenario.yaml \\`,
    `  --seller "${'${SELLER_SPEC:-scripted-disciplined}'}" \\`,
    `  --out /logs/verifier`,
    `cat /logs/verifier/reward.txt`,
  ].join('\n') + '\n');

  put('solution/solve.sh', [
    `#!/usr/bin/env bash`,
    `# Oracle solution: the disciplined reference seller must score reward 1.0.`,
    `set -euo pipefail`,
    `SELLER_SPEC=scripted-disciplined bash /app/tests/test.sh`,
  ].join('\n') + '\n');

  put('rubrics.txt', [
    `# Rubric-as-reward (secondary, gated). Deterministic milestones are primary (60%).`,
    `# DVI (The Value Engine) dimensions — reward weight 30%, band-normalized:`,
    `+ MEDDPICC evidence (buyer-cited, multi-source)   ... up to 40 DVI pts`,
    `+ 3 Whys in the buyer's own words                 ... up to 20 DVI pts`,
    `+ Economic-buyer engagement + conditional commit  ... up to 15 DVI pts`,
    `+ MAP dates buyer-confirmed                        ... up to 15 DVI pts`,
    `+ Champion tested (ask with internal cost)         ... up to 10 DVI pts`,
    ``,
    `# Critical-integrity VETO (zeroes rubric, halves milestone credit):`,
    `- Fabricated buyer quote`,
    `- Hallucinated capability`,
    `- Discount beyond tolerance`,
    `- Never reached the economic buyer`,
    `- Failed quantification`,
  ].join('\n') + '\n');

  return written;
}

function q(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
