/**
 * Scalar RL reward in [0,1]. Deterministic milestones are primary (60%),
 * the evidence-graded DVI rubric is a gated secondary (30%), and
 * `outcome==='won'` is the deal-level gate that banks the full 1.0 anchor
 * (so the oracle scores exactly 1.0). A critical integrity failure
 * (fabricated quote / hallucinated capability / discount beyond tolerance,
 * etc.) vetoes: it zeroes the rubric and halves the milestone credit, so a
 * dishonest rollout can never look clean. A rollout that earned no required
 * facts at all is floored to 0 (nothing banked), but any facts earned keeps
 * the graded milestone gradient alive. Mirrors vision §D1.
 */
import type { Episode, WinConditions } from '../types.js';
import type { DiagnosticGradeReport } from '../grading/taxonomy.js';
import { computeMilestones, type MilestoneResult } from './milestones.js';

export interface RewardBreakdown {
  reward: number;
  resolved: boolean;
  milestonePartial: number;
  rubricNorm: number;
  vetoed: boolean;
  criticalFailures: string[];
  milestones: MilestoneResult['milestones'];
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round = (n: number): number => Math.round(n * 1000) / 1000;

export function computeReward(episode: Episode, grade: DiagnosticGradeReport, wc: WinConditions): RewardBreakdown {
  const ms = computeMilestones(episode.finalState, wc);
  const resolved = episode.outcome === 'won';
  const rubricNorm = clamp01(grade.dvi.total / 100);
  const criticalFailures = grade.failureModes.filter((f) => f.severity === 'critical').map((f) => f.modeId);
  const vetoed = criticalFailures.length > 0;

  // Zero-facts floor: a rollout that earned no required facts at all banks
  // nothing, but any facts earned keeps the graded milestone gradient alive.
  const factsMilestone = ms.milestones.find((m) => m.id === 'facts');
  const noFactsEarned = (factsMilestone?.score ?? 0) === 0;

  let reward: number;
  if (resolved && !vetoed) {
    reward = 1;
  } else if (noFactsEarned) {
    reward = 0;
  } else {
    const partial = vetoed ? 0.6 * ms.milestonePartial * 0.5 : 0.6 * ms.milestonePartial + 0.3 * rubricNorm;
    reward = Math.min(0.98, partial);
  }

  return {
    reward: round(reward),
    resolved,
    milestonePartial: ms.milestonePartial,
    rubricNorm: round(rubricNorm),
    vetoed,
    criticalFailures,
    milestones: ms.milestones,
  };
}
