/**
 * Sellable RLVR dataset packager. Where the verifier persists only the scalar
 * artifacts (reward.txt / ctrf.json / result.json) for a single rollout, this
 * emits the *trajectory* itself as a training datapoint: one self-describing
 * JSONL record per rollout carrying the full turn/event transcript, the
 * verifiable reward breakdown, and the frozen-env provenance (task_checksum,
 * buyer_sim, seed, git). Runs fully offline in mock.
 *
 * The default policy roster is deliberately reward-diverse — the disciplined
 * oracle (banks 1.0), the undisciplined baseline (floor), and the five
 * reward-hack exploits (~0, vetoed) — so a single scenario yields a labeled
 * spread a lab can train a reward model or preference ranker on out of the box.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Scenario, Turn, TranscriptEvent } from '../types.js';
import type { SellerAdapter } from '../seller/index.js';
import { createSeller } from '../seller/index.js';
import type { EnvProvenance } from './provenance.js';
import type { RewardBreakdown } from './reward.js';
import { verifyScenario } from './verifier.js';
import { exploitPolicies } from './audit.js';

export type PolicyKind = 'oracle' | 'floor' | 'exploit';

export interface DatasetPolicy {
  /** Seller spec or exploit id — the recorded label of who produced this rollout. */
  id: string;
  label: string;
  kind: PolicyKind;
  /** Adversarial intent, present only for exploit policies. */
  intent?: string;
}

export interface RlvrDatapoint {
  id: string;
  task: { scenario_id: string; task_checksum: string; buyer_sim: string; seed: number | null };
  policy: DatasetPolicy;
  trajectory: { turns: Turn[]; events: TranscriptEvent[] };
  reward: {
    value: number;
    resolved: boolean;
    vetoed: boolean;
    critical_failures: string[];
    milestone_partial: number;
    rubric_norm: number;
    milestones: RewardBreakdown['milestones'];
  };
  provenance: EnvProvenance;
}

export interface DatasetCard {
  scenario_id: string;
  benchmark_version: string;
  generated_at: string;
  task: { scenario_id: string; task_checksum: string; buyer_sim: string; seed: number | null };
  count: number;
  policies: DatasetPolicy[];
  reward: { min: number; max: number; mean: number; by_policy: { id: string; value: number }[] };
  jsonl_sha256: string;
}

export interface PackageOptions {
  scenario: Scenario;
  runsDir: string;
  outDir: string;
  generatedAt?: string;
}

export function benchmarkVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface PolicyPlan {
  policy: DatasetPolicy;
  seller: SellerAdapter;
}

/** The default reward-diverse roster: oracle (1.0), floor (<0.5), 5 exploits (~0). */
function defaultRoster(): PolicyPlan[] {
  const plans: PolicyPlan[] = [
    {
      policy: { id: 'scripted-disciplined', label: 'Disciplined oracle', kind: 'oracle' },
      seller: createSeller('scripted-disciplined', false),
    },
    {
      policy: { id: 'scripted-baseline', label: 'Undisciplined baseline', kind: 'floor' },
      seller: createSeller('scripted-baseline', false),
    },
  ];
  for (const ex of exploitPolicies()) {
    plans.push({
      policy: { id: ex.id, label: `Exploit: ${ex.id}`, kind: 'exploit', intent: ex.intent },
      seller: ex,
    });
  }
  return plans;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function buildDatapoint(
  scenario: Scenario,
  plan: PolicyPlan,
  runsDir: string,
  generatedAt: string,
): Promise<RlvrDatapoint> {
  const { result, episode } = await verifyScenario({
    scenario,
    sellerSpec: plan.policy.id,
    seller: plan.seller,
    pack: false,
    mock: true,
    runsDir,
    generatedAt,
  });
  const b = result.breakdown;
  return {
    id: `${scenario.id}::${plan.policy.id}`,
    task: {
      scenario_id: scenario.id,
      task_checksum: result.provenance.taskChecksum,
      buyer_sim: result.provenance.buyerSim,
      seed: result.provenance.seed,
    },
    policy: plan.policy,
    trajectory: { turns: episode.turns, events: episode.events },
    reward: {
      value: b.reward,
      resolved: b.resolved,
      vetoed: b.vetoed,
      critical_failures: b.criticalFailures,
      milestone_partial: b.milestonePartial,
      rubric_norm: b.rubricNorm,
      milestones: b.milestones,
    },
    provenance: result.provenance,
  };
}

/**
 * Runs the default reward-diverse roster and returns the datapoints in memory
 * (no disk writes). `packageDataset` serializes these to JSONL + card; other
 * callers (e.g. the env-evidence emitter) consume the rows directly.
 */
export async function buildDataset(
  scenario: Scenario,
  runsDir: string,
  generatedAt: string,
): Promise<{ rows: RlvrDatapoint[]; policies: DatasetPolicy[] }> {
  const roster = defaultRoster();
  const rows: RlvrDatapoint[] = [];
  for (const plan of roster) {
    rows.push(await buildDatapoint(scenario, plan, runsDir, generatedAt));
  }
  return { rows, policies: roster.map((p) => p.policy) };
}

export async function packageDataset(opts: PackageOptions): Promise<DatasetCard> {
  const { scenario, runsDir, outDir } = opts;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const { rows, policies } = await buildDataset(scenario, runsDir, generatedAt);

  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  mkdirSync(outDir, { recursive: true });
  const jsonlPath = join(outDir, 'dataset.jsonl');
  writeFileSync(jsonlPath, jsonl, 'utf8');
  const jsonlSha256 = createHash('sha256').update(readFileSync(jsonlPath)).digest('hex');

  const values = rows.map((r) => r.reward.value);
  const first = rows[0];
  const card: DatasetCard = {
    scenario_id: scenario.id,
    benchmark_version: benchmarkVersion(),
    generated_at: generatedAt,
    task: first.task,
    count: rows.length,
    policies,
    reward: {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: round(values.reduce((a, v) => a + v, 0) / values.length),
      by_policy: rows.map((r) => ({ id: r.policy.id, value: r.reward.value })),
    },
    jsonl_sha256: jsonlSha256,
  };
  writeFileSync(join(outDir, 'dataset.json'), `${JSON.stringify(card, null, 2)}\n`, 'utf8');
  return card;
}
