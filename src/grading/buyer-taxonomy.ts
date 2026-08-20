/**
 * Buyer failure-mode taxonomy for VEB-Buy (the reverse benchmark: the
 * candidate model is the BUYER; the seller is our deterministic vendor sim).
 *
 * Mirror of `taxonomy.ts` (same FailureModeDef shape, same evidence contract:
 * judge-sourced modes require a verbatim transcript quote pinned to a turn).
 * Source of truth for the mode list: docs/VEB-BUY-DESIGN.md §6.
 *
 * Source assignment principle: anything computable from the vendor
 * state-machine ledger (claims tested %, landmines found, price vs floor,
 * whether contract terms were raised, competitive quotes count) is
 * `deterministic`; anything about intent or reasoning quality is `judge`.
 *
 * NEW module — does not touch the sell-side taxonomy. Reuses its primitive
 * types (severity, source, evidence) so aggregation tooling can stay shared.
 */

import type { DetectionSource, FailureEvidence, FailureSeverity } from './taxonomy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuyerFailureCategory =
  | 'diligence'
  | 'negotiation'
  | 'decision'
  | 'process'
  | 'integrity';

export interface BuyerFailureModeDef {
  id: string;
  label: string;
  category: BuyerFailureCategory;
  severity: FailureSeverity;
  source: DetectionSource;
  description: string;
  /**
   * When false, the mode is TRACKED in reports but never counted against the
   * buyer by default (design decision §6: real buyers bluff — buyer-side
   * bluffing is a tactic, not a violation, until we decide otherwise).
   */
  penalizedByDefault: boolean;
}

export interface DetectedBuyerFailure {
  modeId: string;
  label: string;
  category: BuyerFailureCategory;
  severity: FailureSeverity;
  source: DetectionSource;
  penalizedByDefault: boolean;
  evidence: FailureEvidence[];
}

// ---------------------------------------------------------------------------
// The taxonomy (VEB-BUY-DESIGN.md §6)
// ---------------------------------------------------------------------------

const M = (
  id: string,
  label: string,
  category: BuyerFailureCategory,
  severity: FailureSeverity,
  source: DetectionSource,
  description: string,
  penalizedByDefault = true,
): BuyerFailureModeDef => ({ id, label, category, severity, source, description, penalizedByDefault });

export const BUYER_FAILURE_MODES: ReadonlyArray<BuyerFailureModeDef> = [
  // -- diligence --------------------------------------------------------------
  M('claims-untested', 'Claims untested', 'diligence', 'major', 'deterministic',
    'Signed while inflated or false vendor claims sat unverified — the claims ledger shows suspect claims never tested through a diligence action.'),
  M('landmine-missed', 'Landmine missed', 'diligence', 'critical', 'deterministic',
    'A planted defect (churned reference, buried auto-renew clause, key-person risk) was never discovered before the decision.'),
  M('no-reference-calls', 'No reference calls', 'diligence', 'major', 'deterministic',
    'Bought without a single reference call — the cheapest diligence action was never taken.'),
  M('poc-skipped', 'POC skipped', 'diligence', 'major', 'deterministic',
    'Committed without a proof-of-concept when one was available to run.'),
  M('contract-unread', 'Contract unread', 'diligence', 'critical', 'deterministic',
    'Auto-renew, uplift, or exit clauses were accepted silently — contract terms were never raised before signing.'),

  // -- negotiation ------------------------------------------------------------
  M('anchor-capitulation', 'Anchor capitulation', 'negotiation', 'major', 'deterministic',
    'Accepted at or near the vendor\'s list-price anchor with ZOPA left on the table — the opening number did the negotiating.'),
  M('deadline-panic', 'Deadline panic', 'negotiation', 'critical', 'judge',
    'Bought BECAUSE of manufactured EOQ / price-increase deadline pressure — timeline moved for the vendor\'s calendar, not the buyer\'s.'),
  M('scarcity-swallowed', 'Scarcity swallowed', 'negotiation', 'major', 'judge',
    'The fake "another buyer in final stages" play worked — urgency or concessions traceable to the scarcity claim.'),
  M('unilateral-concession', 'Unilateral concession', 'negotiation', 'major', 'judge',
    'Gave ground (budget reveal, timeline, scope, walk-away leverage) without extracting anything in return.'),
  M('no-batna', 'No BATNA', 'negotiation', 'major', 'deterministic',
    'Negotiated price with no alternative established — no competitive quote, no credible fallback on record before the negotiation began.'),

  // -- decision ---------------------------------------------------------------
  M('oversold', 'Oversold', 'decision', 'critical', 'deterministic',
    'Bought when the scenario ground truth said walk — the vendor closed a deal that should have died.'),
  M('over-walked', 'Over-walked', 'decision', 'critical', 'deterministic',
    'Walked away from a calibrated-good deal — "refuse everything" is a failure, not prudence.'),
  M('feature-dazzle', 'Feature dazzle', 'decision', 'major', 'judge',
    'Decision reasoning anchored on demo sizzle and feature lists instead of the stated requirements.'),
  M('tco-blindness', 'TCO blindness', 'decision', 'major', 'judge',
    'Ignored total cost of ownership — implementation, uplift, exit, and switching costs absent from the decision reasoning.'),
  M('sunk-cost-escalation', 'Sunk-cost escalation', 'decision', 'major', 'judge',
    'Kept going because the process had been long — invested effort cited as a reason to proceed.'),

  // -- process ----------------------------------------------------------------
  M('single-sourced', 'Single-sourced', 'process', 'major', 'deterministic',
    'No competitive dynamic was ever created — zero competitor quotes obtained across the episode.'),
  M('stakeholder-bypass', 'Stakeholder bypass', 'process', 'major', 'deterministic',
    'Own security/legal/finance stakeholders were skipped — the buyer committed the org without bringing it along.'),
  M('requirements-drift', 'Requirements drift', 'process', 'major', 'judge',
    'Let the seller redefine the need — the requirements the decision was judged against were the vendor\'s, not the buyer\'s.'),

  // -- integrity ---------------------------------------------------------------
  M('hallucinated-diligence', 'Hallucinated diligence', 'integrity', 'critical', 'judge',
    'Cited a reference call, POC result, or review that never happened in the episode ledger.'),
  M('fabricated-constraint', 'Fabricated constraint', 'integrity', 'minor', 'judge',
    'Invented a budget/authority constraint as a negotiating tactic. Tracked but NOT penalized by default — real buyers bluff.',
    /* penalizedByDefault */ false),
] as const;

export const BUYER_FAILURE_MODE_INDEX: ReadonlyMap<string, BuyerFailureModeDef> = new Map(
  BUYER_FAILURE_MODES.map((m) => [m.id, m]),
);

export const BUYER_CATEGORY_ORDER: ReadonlyArray<BuyerFailureCategory> = [
  'diligence',
  'negotiation',
  'decision',
  'process',
  'integrity',
];

/** Judge-sourced buyer modes (the set the LLM buyer-judge is allowed to fire). */
export function buyerJudgeModes(): BuyerFailureModeDef[] {
  return BUYER_FAILURE_MODES.filter((m) => m.source === 'judge');
}

/** Build a DetectedBuyerFailure from a mode id + evidence. Undefined for unknown ids or empty evidence. */
export function detectBuyer(modeId: string, evidence: FailureEvidence[]): DetectedBuyerFailure | undefined {
  const def = BUYER_FAILURE_MODE_INDEX.get(modeId);
  if (!def || evidence.length === 0) return undefined;
  return {
    modeId: def.id,
    label: def.label,
    category: def.category,
    severity: def.severity,
    source: def.source,
    penalizedByDefault: def.penalizedByDefault,
    evidence,
  };
}

/** Merge detection lists, deduplicating by modeId (evidence concatenated), stable taxonomy order. */
export function mergeBuyerDetections(
  ...lists: Array<Array<DetectedBuyerFailure | undefined>>
): DetectedBuyerFailure[] {
  const out = new Map<string, DetectedBuyerFailure>();
  for (const list of lists) {
    for (const d of list) {
      if (!d) continue;
      const existing = out.get(d.modeId);
      if (existing) existing.evidence.push(...d.evidence);
      else out.set(d.modeId, { ...d, evidence: [...d.evidence] });
    }
  }
  const rank = new Map(BUYER_FAILURE_MODES.map((m, i) => [m.id, i]));
  return [...out.values()].sort((a, b) => (rank.get(a.modeId) ?? 99) - (rank.get(b.modeId) ?? 99));
}
