/**
 * Verifier: run ONE episode (mock or live), grade it, convert the deterministic
 * final state + rubric into a scalar reward, and (optionally) emit the
 * standard verifier artifacts. This is what `env verify` and the difficulty
 * gate call. Oracle proof: scripted-disciplined must return reward 1.0.
 */
import { runEpisode } from '../engine/runner.js';
import { createSeller, type SellerAdapter } from '../seller/index.js';
import { gradeEpisode } from '../grading/judge.js';
import type { Scenario, Episode } from '../types.js';
import { computeReward } from './reward.js';
import { buildEnvProvenance, taskChecksum } from './provenance.js';
import { buildCtrf, type CtrfReport } from './ctrf.js';
import { writeVerifierArtifacts, type EnvResult } from './emit.js';
import { buyerSimVersion } from './buyer-sim.js';
import { BuyerTranscript } from './buyer-transcript.js';
import type { DiagnosticGradeReport } from '../grading/taxonomy.js';

/**
 * Buyer-sim freezing mode (orthogonal to `mock`, which decides who *generates*
 * during record):
 *  - 'live'   (default): no transcript — today's behavior.
 *  - 'record': capture buyer replies to `transcriptDir` for later replay.
 *  - 'replay': serve buyer replies from `transcriptDir` verbatim; the buyer
 *    LLM is never invoked, so reward reproduces bit-for-bit.
 */
export type BuyerMode = 'live' | 'record' | 'replay';

export interface VerifyOptions {
  scenario: Scenario;
  sellerSpec: string;
  pack: boolean;
  mock: boolean;
  runsDir: string;
  outDir?: string;
  generatedAt?: string;
  buyerMode?: BuyerMode;
  /** Required when buyerMode is 'record' or 'replay'. */
  transcriptDir?: string;
  /**
   * Pre-built seller to run instead of resolving `sellerSpec` via createSeller.
   * Used by the reward-hack audit to inject adversarial exploit policies that
   * must never reach the production seller registry. `sellerSpec` is still the
   * recorded label.
   */
  seller?: SellerAdapter;
}

export interface VerifyResult {
  result: EnvResult;
  ctrf: CtrfReport;
  /** The full graded episode (turns + events). Carried so callers can package
   * the trajectory into a sellable RLVR datapoint; artifacts still persist only
   * reward/ctrf/result. */
  episode: Episode;
  /** The full grade report that fed computeReward. Frozen alongside the episode
   * so a buyer can re-run computeReward(episode, grade, wc) and reproduce the
   * reward bit-for-bit — even in the clean-partial band where the DVI rubric is
   * LLM-judged. Same freeze pattern as the buyer transcript. */
  grade: DiagnosticGradeReport;
}

export async function verifyScenario(opts: VerifyOptions): Promise<VerifyResult> {
  const { scenario, sellerSpec, pack, mock, runsDir } = opts;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const buyerMode = opts.buyerMode ?? 'live';

  let transcript: BuyerTranscript | undefined;
  if (buyerMode === 'record') {
    if (!opts.transcriptDir) throw new Error("buyerMode 'record' requires transcriptDir");
    transcript = new BuyerTranscript('record', {
      buyerSim: buyerSimVersion(),
      taskChecksum: taskChecksum(scenario),
      seed: scenario.generation?.seed ?? null,
    });
  } else if (buyerMode === 'replay') {
    if (!opts.transcriptDir) throw new Error("buyerMode 'replay' requires transcriptDir");
    transcript = BuyerTranscript.load(opts.transcriptDir);
    transcript.assertFreeze(buyerSimVersion(), taskChecksum(scenario));
  }

  // Pin the task identity from the PRISTINE input, before the run. Some policies
  // mutate the scenario during an episode; provenance must describe the task the
  // agent was given, invariant to what it did. Run on a deep clone so a rollout
  // can never leak mutation into the caller's scenario or a sibling rollout.
  const provenance = buildEnvProvenance(scenario, generatedAt);
  const runScenario = structuredClone(scenario);

  const seller = opts.seller ?? createSeller(sellerSpec, pack && !mock);
  const { episode } = await runEpisode({ scenario: runScenario, seller, pack: pack && !mock, mock, runsDir, noPersist: true, transcript });

  if (buyerMode === 'record' && transcript) transcript.save(opts.transcriptDir as string);
  const grade = await gradeEpisode(episode, runScenario);
  const breakdown = computeReward(episode, grade, runScenario.win_conditions);

  const result: EnvResult = {
    scenarioId: episode.scenarioId,
    sellerId: episode.sellerId,
    reward: breakdown.reward,
    resolved: breakdown.resolved,
    provenance,
    breakdown,
  };
  const ctrf = buildCtrf(breakdown, Date.parse(generatedAt) || 0);

  if (opts.outDir) writeVerifierArtifacts(opts.outDir, result, ctrf);
  return { result, ctrf, episode, grade };
}
