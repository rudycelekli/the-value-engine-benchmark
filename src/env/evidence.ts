/**
 * Build-time evidence artifact for the public /benchmark page. Where the
 * dataset packager sells the *rollouts*, this distills the same reward-diverse
 * roster into the *proof a buyer needs to trust the target*: for each flagship,
 * the difficulty-gate view (oracle solves, floor fails), the reward-hack audit
 * view (every exploit defeated below the ceiling), and the labeled reward
 * spread — plus the frozen-env provenance (buyer_sim, task_checksum, git) that
 * makes all of it reproducible. Runs fully offline in mock, in seconds, $0.
 *
 * Everything is DERIVED from a single `buildDataset()` pass per scenario: each
 * datapoint row already carries policy kind/intent and the verifiable reward
 * breakdown, so the gate and audit views need no redundant re-runs.
 */
import type { Scenario } from '../types.js';
import {
  buildDataset,
  benchmarkVersion,
  type RlvrDatapoint,
  type DatasetPolicy,
  type PolicyKind,
} from './dataset.js';
import { ORACLE_MIN, FLOOR_MAX } from './gate.js';
import { AUDIT_CEILING } from './audit.js';

/** The public flagship set the page anchors on: two gate-passers + the hard case. */
export const FLAGSHIP_SCENARIOS = [
  'scenarios/01-logistics-saas.yaml',
  'scenarios/02-enterprise-bank.yaml',
  'scenarios/03-hostile-renewal.yaml',
];

export interface ExploitEvidence {
  id: string;
  intent: string;
  reward: number;
  resolved: boolean;
  vetoed: boolean;
  criticalFailures: string[];
  /** true if defeated: reward below ceiling AND the deal was not resolved. */
  defeated: boolean;
}

export interface ScenarioEvidence {
  scenario_id: string;
  task_checksum: string;
  seed: number | null;
  gate: { oracle: number; floor: number; oraclePass: boolean; floorPass: boolean; pass: boolean };
  audit: { ceiling: number; worstReward: number; pass: boolean; exploits: ExploitEvidence[] };
  reward_spread: {
    min: number;
    mean: number;
    max: number;
    by_policy: { id: string; kind: PolicyKind; value: number }[];
  };
}

/** A representative full datapoint, trajectory replaced by counts to keep the page light. */
export interface SampleDatapoint {
  id: string;
  policy: DatasetPolicy;
  task: RlvrDatapoint['task'];
  reward: RlvrDatapoint['reward'];
  trajectory_summary: { turns: number; events: number };
}

export interface EnvEvidence {
  generated_at: string;
  benchmark_version: string;
  buyer_sim: string;
  git: { sha: string; dirty: boolean };
  thresholds: { oracle_min: number; floor_max: number; audit_ceiling: number };
  exploits: { id: string; intent: string }[];
  scenarios: ScenarioEvidence[];
  sample_datapoint: SampleDatapoint;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function scenarioEvidence(rows: RlvrDatapoint[]): ScenarioEvidence {
  const oracle = rows.find((r) => r.policy.kind === 'oracle');
  const floor = rows.find((r) => r.policy.kind === 'floor');
  const exploitRows = rows.filter((r) => r.policy.kind === 'exploit');
  if (!oracle || !floor) throw new Error('roster missing oracle/floor rollout');

  const oracleReward = oracle.reward.value;
  const floorReward = floor.reward.value;
  const oraclePass = oracleReward >= ORACLE_MIN;
  const floorPass = floorReward < FLOOR_MAX;

  const exploits: ExploitEvidence[] = exploitRows.map((r) => {
    const reward = r.reward.value;
    const resolved = r.reward.resolved;
    return {
      id: r.policy.id,
      intent: r.policy.intent ?? '',
      reward,
      resolved,
      vetoed: r.reward.vetoed,
      criticalFailures: r.reward.critical_failures,
      defeated: reward < AUDIT_CEILING && !resolved,
    };
  });
  const worstReward = exploits.length ? Math.max(...exploits.map((x) => x.reward)) : 0;

  const values = rows.map((r) => r.reward.value);
  return {
    scenario_id: oracle.task.scenario_id,
    task_checksum: oracle.task.task_checksum,
    seed: oracle.task.seed,
    gate: { oracle: oracleReward, floor: floorReward, oraclePass, floorPass, pass: oraclePass && floorPass },
    audit: {
      ceiling: AUDIT_CEILING,
      worstReward,
      pass: exploits.every((x) => x.defeated),
      exploits,
    },
    reward_spread: {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: round(values.reduce((a, v) => a + v, 0) / values.length),
      by_policy: rows.map((r) => ({ id: r.policy.id, kind: r.policy.kind, value: r.reward.value })),
    },
  };
}

export async function buildEnvEvidence(
  scenarios: Scenario[],
  runsDir: string,
  generatedAt: string,
): Promise<EnvEvidence> {
  const perScenario: { rows: RlvrDatapoint[]; evidence: ScenarioEvidence }[] = [];
  for (const scenario of scenarios) {
    const { rows } = await buildDataset(scenario, runsDir, generatedAt);
    perScenario.push({ rows, evidence: scenarioEvidence(rows) });
  }

  const firstRow = perScenario[0].rows[0];
  const exploitRoster = perScenario[0].rows
    .filter((r) => r.policy.kind === 'exploit')
    .map((r) => ({ id: r.policy.id, intent: r.policy.intent ?? '' }));

  // Representative datapoint: the oracle from the first gate-passing scenario.
  const gatePasser = perScenario.find((p) => p.evidence.gate.pass) ?? perScenario[0];
  const oracleRow = gatePasser.rows.find((r) => r.policy.kind === 'oracle') ?? gatePasser.rows[0];
  const sample_datapoint: SampleDatapoint = {
    id: oracleRow.id,
    policy: oracleRow.policy,
    task: oracleRow.task,
    reward: oracleRow.reward,
    trajectory_summary: {
      turns: oracleRow.trajectory.turns.length,
      events: oracleRow.trajectory.events.length,
    },
  };

  return {
    generated_at: generatedAt,
    benchmark_version: benchmarkVersion(),
    buyer_sim: firstRow.task.buyer_sim,
    git: firstRow.provenance.git,
    thresholds: { oracle_min: ORACLE_MIN, floor_max: FLOOR_MAX, audit_ceiling: AUDIT_CEILING },
    exploits: exploitRoster,
    scenarios: perScenario.map((p) => p.evidence),
    sample_datapoint,
  };
}
