/**
 * A single frontier rollout = one graded episode captured as a self-contained,
 * verifiable RLVR datapoint. This is the unit VEB-Pro sells. The full trajectory
 * (the product) plus the deterministic reward, cost, frozen buyer-sim descriptor,
 * and SHA-256 task checksum travel together so a buyer can re-grade the frozen
 * trajectory and reproduce the reward bit-for-bit.
 *
 * Reward verifiability is unchanged from mock: the LLM seller only chooses
 * actions; `computeReward` scores the deterministic final state. Swapping a real
 * model in as the seller adds realism, not reward risk.
 */
import { withUsageScope } from '../seller/providers.js';
import { withPortkeyMeta } from '../llm.js';
import { costOfUsage } from '../models.js';
import { formatRetryTotals } from '../seller/index.js';
import { verifyScenario } from './verifier.js';
import { ORACLE_MIN } from './gate.js';
import { buyerSimVersion } from './buyer-sim.js';
import type { Scenario, Episode } from '../types.js';
import type { EnvProvenance } from './provenance.js';
import type { RewardBreakdown } from './reward.js';
import type { DiagnosticGradeReport } from '../grading/taxonomy.js';

export interface RolloutEnvRef {
  scenario_id: string;
  task_checksum: string;
  seed: number | null;
}
export interface RolloutModelRef {
  spec: string; // e.g. 'anthropic:claude-opus-4-8' or 'scripted-disciplined'
  provider: string; // 'anthropic' | 'openai' | 'xai' | 'gemini' | 'scripted'
  model: string; // bare model id, or the scripted policy name
  pack: boolean;
}
export interface RolloutCost {
  input_tokens: number;
  output_tokens: number;
  usd: number;
}
export interface RolloutDatapoint {
  id: string;
  env: RolloutEnvRef;
  model: RolloutModelRef;
  buyer_sim: string;
  seed: number;
  reward: number;
  resolved: boolean;
  cleared_bar: boolean; // reward >= ORACLE_MIN
  reward_breakdown: RewardBreakdown;
  trajectory: { turns: number; events: number };
  format_retries: number;
  cost: RolloutCost;
  transcript_ref: string | null;
  provenance: EnvProvenance;
  generated_at: string;
  /** Full graded episode — the sellable RLVR trajectory. Written to dataset.jsonl. */
  episode: Episode;
  /** Frozen grade report that produced the reward. With the episode's frozen
   * final state, this lets a buyer re-run computeReward(episode, grade, wc) and
   * reproduce `reward` bit-for-bit — including the LLM-judged DVI rubric, which
   * is captured here rather than re-derived (same freeze contract as the buyer
   * transcript). This is what makes the RLVR reward verifiable end-to-end. */
  grade: DiagnosticGradeReport;
}

export interface RolloutOptions {
  scenario: Scenario;
  sellerSpec: string;
  pack: boolean;
  seed: number;
  runsDir: string;
  mock: boolean;
  /** When set and NOT mock, run buyerMode='record' and persist the buyer transcript here. */
  transcriptDir?: string;
  generatedAt?: string;
}

function specParts(spec: string): { provider: string; model: string } {
  const [head, ...rest] = spec.split(':');
  return rest.length ? { provider: head, model: rest.join(':') } : { provider: 'scripted', model: spec };
}

function usageTotalsFrom(usage: Map<string, { inputTokens: number; outputTokens: number }>): {
  input: number;
  output: number;
} {
  let input = 0;
  let output = 0;
  for (const u of usage.values()) {
    input += u.inputTokens;
    output += u.outputTokens;
  }
  return { input, output };
}

export async function runFrontierRollout(opts: RolloutOptions): Promise<RolloutDatapoint> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const { provider, model } = specParts(opts.sellerSpec);
  const pack = opts.pack;

  // The rollout seed is a rollout-level LABEL, not part of the env identity: it
  // must NOT be folded into the scenario, or each seed would produce a different
  // task_checksum and look like a different environment. Seed-to-seed variation
  // comes from LLM stochasticity (buyer t=0.8, seller t=0.7), not the scenario.
  // verifyScenario deep-clones its scenario arg internally, so pass it as-is.
  const record = Boolean(opts.transcriptDir) && !opts.mock;
  const retriesBefore = formatRetryTotals().get(opts.sellerSpec) ?? 0;

  // Per-rollout Portkey join keys — inherited by every seller/buyer/judge call
  // underneath (AsyncLocalStorage). These let the offline analytics API slice
  // latency/cost/tokens/status by model AND by individual cell. Inert to cost:
  // they only add header keys, never touch the budget/usage path.
  const portkeyMeta = {
    model_spec: opts.sellerSpec,
    scenario: opts.scenario.id,
    seed: opts.seed,
    track: pack ? 'pack' : 'oob',
    row_id: `${opts.scenario.id}·${opts.sellerSpec}${pack ? '+pack' : ''}·s${opts.seed}`,
  };

  const { result: verify, usage } = await withPortkeyMeta(portkeyMeta, () =>
    withUsageScope(() =>
      verifyScenario({
        scenario: opts.scenario,
        sellerSpec: opts.sellerSpec,
        pack,
        mock: opts.mock,
        runsDir: opts.runsDir,
        generatedAt,
        buyerMode: record ? 'record' : 'live',
        transcriptDir: record ? opts.transcriptDir : undefined,
      }),
    ),
  );

  const { result, episode, grade } = verify;
  const retriesAfter = formatRetryTotals().get(opts.sellerSpec) ?? 0;
  const tok = usageTotalsFrom(usage);
  const packSuffix = pack ? '+pack' : '';
  const id = `${result.scenarioId}·${opts.sellerSpec}${packSuffix}·s${opts.seed}`;

  return {
    id,
    env: {
      scenario_id: result.scenarioId,
      task_checksum: result.provenance.taskChecksum,
      seed: result.provenance.seed,
    },
    model: { spec: opts.sellerSpec, provider, model, pack },
    buyer_sim: buyerSimVersion(),
    seed: opts.seed,
    reward: result.reward,
    resolved: result.resolved,
    cleared_bar: result.reward >= ORACLE_MIN,
    reward_breakdown: result.breakdown,
    trajectory: { turns: episode.turns.length, events: episode.events.length },
    format_retries: retriesAfter - retriesBefore,
    cost: { input_tokens: tok.input, output_tokens: tok.output, usd: costOfUsage(usage) },
    transcript_ref: record ? (opts.transcriptDir as string) : null,
    provenance: result.provenance,
    generated_at: generatedAt,
    episode,
    grade,
  };
}
