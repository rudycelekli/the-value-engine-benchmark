/**
 * BQS — Buyer Quality Score for VEB-Buy (VEB-BUY-DESIGN.md §5).
 *
 *   BQS = 0.35·DecisionQuality + 0.25·SurplusCapture
 *       + 0.25·DiligenceCoverageIndex + 0.15·ProcessDiscipline
 *
 * All components 0–100. Anti-gaming constraint #1: "refuse everything" must
 * not win — the scenario ground truth defines the right answer, and both
 * over-buying and over-walking are failures.
 *
 * INPUT CONTRACT: this module takes ground truth as a typed parameter,
 * `VendorLedgerSummary`, defined LOCALLY here. The vendor sim
 * (src/vendor/*) is being built in parallel; do NOT import from it. When the
 * vendor sim lands, it exports/adapts to this summary shape.
 */

// ---------------------------------------------------------------------------
// Ground-truth input (produced by the vendor state machine's ledger)
// ---------------------------------------------------------------------------

/**
 * Scenario-calibrated right answer (decision calibration, design §7).
 * Canonical 4-value underscore union — structurally identical to
 * src/vendor/types.ts and src/generator/buy-params.ts (the vendor-side
 * adapter in src/vendor/ledger-summary.ts imports VendorLedgerSummary from
 * here, so tsc enforces the seam).
 */
export type RightAnswer = 'buy' | 'negotiate_then_buy' | 'negotiate_hard' | 'walk';

/** What the buyer actually did by episode end. */
export type BuyerDecision = 'bought' | 'walked' | 'no-decision';

/**
 * Deterministic ground truth distilled from the vendor sim's hidden ledger
 * (claims ledger, landmines, tactic schedule, concession policy) plus the
 * buyer's observable actions. Everything here is mechanically computable —
 * no judge required.
 */
export interface VendorLedgerSummary {
  /** Scenario ground truth. */
  rightAnswer: RightAnswer;
  /** Buyer's terminal decision. */
  decision: BuyerDecision;

  /** Buyer org's budget ceiling (top of the ZOPA). */
  budgetCeiling: number;
  /** Vendor's true walk-away floor (bottom of the ZOPA). */
  sellerFloor: number;
  /** Vendor's opening anchor / list price. */
  listPrice: number;
  /** Final price, when `decision === 'bought'`. */
  pricePaid?: number;

  /** Claims ledger. `suspect` = tagged inflated|false in ground truth. */
  claimsTotal: number;
  claimsSuspectTotal: number;
  /** Suspect claims the buyer tested via a diligence action BEFORE deciding. */
  claimsSuspectTested: number;

  /** Landmines planted / discovered before the decision. */
  landminesPlanted: number;
  landminesDiscovered: number;

  /** Diligence action counters. */
  referenceCallsMade: number;
  pocAvailable: boolean;
  pocRun: boolean;
  /** Auto-renew / uplift / exit terms raised before signing. */
  contractTermsRaised: boolean;

  /** Process discipline (deterministic assists). */
  competitiveQuotesObtained: number;
  batnaEstablishedBeforeNegotiation: boolean;
  ownStakeholdersConsulted: boolean;

  /** Vendor tactic flags (from the tactic schedule + timing of the close). */
  deadlineTacticFired: boolean;
  /** Buyer signed inside the manufactured deadline window. */
  boughtInsideDeadlineWindow: boolean;
  scarcityTacticFired: boolean;

  // --- Multi-issue economy (docs/MULTI-ISSUE-ECONOMY.md §4) ------------------
  // All optional: price-only scenarios omit them and SC stays ZOPA-based.
  // Plain numbers/strings only — this module must not import from src/vendor.

  /** Human-readable final package, e.g. "price $42,500 · term 36 months · …". */
  finalTermsSummary?: string;
  /** Buyer utility of the final package: ceiling − price + Σ buyerValue. */
  buyerUtilityFinal?: number;
  /** Joint surplus of the final package (buyer + vendor utility). */
  jointSurplusFinal?: number;
  /** Best buyer utility achievable under the deterministic trade rules. */
  oracleBuyerSurplus?: number;
  /** Max joint surplus over all level combos (price-invariant). */
  maxJointSurplus?: number;
  /** jointSurplusFinal / maxJointSurplus, 0–1. */
  paretoEfficiency?: number;
  /** Trade proposals the buyer made / the deal desk accepted. */
  tradesProposed?: number;
  tradesAccepted?: number;
}

// ---------------------------------------------------------------------------
// Judge assists (the ONLY non-deterministic inputs BQS consumes)
// ---------------------------------------------------------------------------

/** How well the final decision was reasoned (judge-graded, evidence-quoted). */
export type ReasoningQuality = 'evidence-grounded' | 'weak';

/** The four PD checklist items. Judge may confirm/deny; deterministic assists fill gaps. */
export interface ProcessChecklist {
  competitiveProcess: boolean;
  batnaBeforeNegotiation: boolean;
  stakeholderAlignment: boolean;
  nonPriceTermsAddressed: boolean;
}

export interface JudgeAssist {
  reasoningQuality: ReasoningQuality;
  /** Wrong answer, but the reasoning was defensible given what was knowable. */
  wrongButDefensible: boolean;
  /** Judge overrides for PD items (undefined item ⇒ use the deterministic assist). */
  processChecklist?: Partial<ProcessChecklist>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface BqsComponents {
  decisionQuality: number;
  surplusCapture: number;
  diligenceCoverage: number;
  processDiscipline: number;
}

export const BQS_WEIGHTS = {
  decisionQuality: 0.35,
  surplusCapture: 0.25,
  diligenceCoverage: 0.25,
  processDiscipline: 0.15,
} as const;

/**
 * Counterfactual regret (docs/COUNTERFACTUAL-REGRET.md). Owned by grading
 * like VendorLedgerSummary — computed vendor-side (src/vendor/regret.ts),
 * plain numbers only, attached to BuyerGradeReport. Diagnostic: regret does
 * NOT enter the BQS number; it explains where surplus went, in dollars.
 */
export interface RegretReport {
  /** False on walk-right scenarios — dollars-left-on-table is undefined there. */
  scored: boolean;
  /** Best utility achievable from the episode's opening state (curve[0]). */
  oracleBuyerSurplus: number;
  /** Buyer utility actually realized (0 when the buyer did not buy). */
  realizedUtility: number;
  totalRegret: number;
  /** Money never unlocked/rebated given the package actually signed. */
  priceRegret: number;
  /** Value lost by signing the wrong package (vs the oracle levels). */
  tradeRegret: number;
  /** Entire oracle surplus foregone by walking/stalling on a buy-right deal. */
  decisionRegret: number;
  /** Achievable-ceiling per consumed buyer turn, closed with realizedUtility. */
  curve: Array<{ turn: number; transcriptIndex: number; ceiling: number }>;
  /** The single turn that destroyed the most value (undefined if none did). */
  largestDrop?: { turn: number; transcriptIndex: number; drop: number };
}

export interface BqsResult {
  bqs: number;
  components: BqsComponents;
  processChecklist: ProcessChecklist;
  /** True when the decision matched the scenario's calibrated right answer. */
  decisionCorrect: boolean;
  details: string[];
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Did the buyer land on the calibrated right answer? (negotiate-then-buy resolves to buying; how WELL is SC's job.) */
export function decisionCorrect(ledger: VendorLedgerSummary): boolean {
  if (ledger.rightAnswer === 'walk') return ledger.decision === 'walked';
  return ledger.decision === 'bought';
}

/**
 * Decision Quality (0–100):
 *   100 — right answer with evidence-grounded reasoning
 *    60 — right answer, weak reasoning
 *    25 — wrong answer, defensible reasoning
 *     0 — oversold (bought a walk) / over-walked (walked a buy) / stalled out
 */
export function decisionQualityScore(ledger: VendorLedgerSummary, assist: JudgeAssist): number {
  if (decisionCorrect(ledger)) return assist.reasoningQuality === 'evidence-grounded' ? 100 : 60;
  return assist.wrongButDefensible ? 25 : 0;
}

/**
 * Surplus Capture (0–100).
 * Walk-correct scenarios: SC = 100 if walked (avoided loss captured), 0 if bought.
 * No purchase where one was right (or no decision): nothing captured → 0.
 * Multi-issue scenarios (docs/MULTI-ISSUE-ECONOMY.md §4): utility-based —
 *   buyerUtilityFinal / oracleBuyerSurplus, clamped 0–1, ×100. The oracle is
 *   the best buyer utility achievable under the deterministic trade rules, so
 *   price-only play caps well below 100 when value-creating trades existed.
 * Price-only scenarios (legacy): where the price landed in the ZOPA,
 *   (budget_ceiling − price_paid) / (budget_ceiling − seller_floor), ×100.
 */
export function surplusCaptureScore(ledger: VendorLedgerSummary): number {
  if (ledger.rightAnswer === 'walk') return ledger.decision === 'walked' ? 100 : 0;
  if (ledger.decision !== 'bought' || ledger.pricePaid === undefined) return 0;
  if (
    ledger.oracleBuyerSurplus !== undefined &&
    ledger.oracleBuyerSurplus > 0 &&
    ledger.buyerUtilityFinal !== undefined
  ) {
    return round1(clamp01(ledger.buyerUtilityFinal / ledger.oracleBuyerSurplus) * 100);
  }
  const zopa = ledger.budgetCeiling - ledger.sellerFloor;
  if (zopa <= 0) return 0; // degenerate scenario: no ZOPA — calibration should reject these
  return round1(clamp01((ledger.budgetCeiling - ledger.pricePaid) / zopa) * 100);
}

/**
 * Diligence Coverage Index (0–100):
 *   50·(landmines discovered / planted) + 50·(suspect claims tested / suspect total).
 * A half with nothing planted/tagged is awarded in full (nothing to miss).
 */
export function diligenceCoverageScore(ledger: VendorLedgerSummary): number {
  const landmineHalf =
    ledger.landminesPlanted > 0 ? clamp01(ledger.landminesDiscovered / ledger.landminesPlanted) : 1;
  const claimsHalf =
    ledger.claimsSuspectTotal > 0 ? clamp01(ledger.claimsSuspectTested / ledger.claimsSuspectTotal) : 1;
  return round1(50 * landmineHalf + 50 * claimsHalf);
}

/**
 * Process Discipline (0–100): 4-item checklist, 25 points each.
 * Judge-scored with deterministic assists: each item defaults to what the
 * ledger proves; the judge may override with cited evidence.
 */
export function processDisciplineScore(
  ledger: VendorLedgerSummary,
  judgeChecklist?: Partial<ProcessChecklist>,
): { score: number; checklist: ProcessChecklist } {
  const deterministic: ProcessChecklist = {
    competitiveProcess: ledger.competitiveQuotesObtained > 0,
    batnaBeforeNegotiation: ledger.batnaEstablishedBeforeNegotiation,
    stakeholderAlignment: ledger.ownStakeholdersConsulted,
    nonPriceTermsAddressed: ledger.contractTermsRaised,
  };
  const checklist: ProcessChecklist = {
    competitiveProcess: judgeChecklist?.competitiveProcess ?? deterministic.competitiveProcess,
    batnaBeforeNegotiation: judgeChecklist?.batnaBeforeNegotiation ?? deterministic.batnaBeforeNegotiation,
    stakeholderAlignment: judgeChecklist?.stakeholderAlignment ?? deterministic.stakeholderAlignment,
    nonPriceTermsAddressed: judgeChecklist?.nonPriceTermsAddressed ?? deterministic.nonPriceTermsAddressed,
  };
  const score = 25 * Object.values(checklist).filter(Boolean).length;
  return { score, checklist };
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export function computeBqs(ledger: VendorLedgerSummary, assist: JudgeAssist): BqsResult {
  const dq = decisionQualityScore(ledger, assist);
  const sc = surplusCaptureScore(ledger);
  const dci = diligenceCoverageScore(ledger);
  const pd = processDisciplineScore(ledger, assist.processChecklist);

  const bqs = round1(
    BQS_WEIGHTS.decisionQuality * dq +
      BQS_WEIGHTS.surplusCapture * sc +
      BQS_WEIGHTS.diligenceCoverage * dci +
      BQS_WEIGHTS.processDiscipline * pd.score,
  );

  const correct = decisionCorrect(ledger);
  const details: string[] = [
    `Decision: ${ledger.decision} vs ground truth ${ledger.rightAnswer} → ${correct ? 'RIGHT' : 'WRONG'} (${assist.reasoningQuality} reasoning${!correct && assist.wrongButDefensible ? ', defensible' : ''}) → DQ ${dq}`,
    ledger.rightAnswer === 'walk'
      ? `Walk-correct scenario: SC = ${sc} (${ledger.decision === 'walked' ? 'loss avoided' : 'bought the walk — nothing captured'})`
      : ledger.decision === 'bought' && ledger.pricePaid !== undefined
        ? ledger.oracleBuyerSurplus !== undefined && ledger.oracleBuyerSurplus > 0 && ledger.buyerUtilityFinal !== undefined
          ? `Buyer utility ${ledger.buyerUtilityFinal} of oracle ${ledger.oracleBuyerSurplus} (paid ${ledger.pricePaid}, list ${ledger.listPrice}${ledger.finalTermsSummary ? `; ${ledger.finalTermsSummary}` : ''}) → SC ${sc}`
          : `Paid ${ledger.pricePaid} in ZOPA [${ledger.sellerFloor}, ${ledger.budgetCeiling}] (list ${ledger.listPrice}) → SC ${sc}`
        : `No purchase where buying was right → SC 0`,
    `DCI ${dci}: landmines ${ledger.landminesDiscovered}/${ledger.landminesPlanted} discovered · suspect claims ${ledger.claimsSuspectTested}/${ledger.claimsSuspectTotal} tested`,
    `PD ${pd.score}: ${(Object.entries(pd.checklist) as Array<[string, boolean]>).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join(' · ')}`,
  ];
  if (ledger.maxJointSurplus !== undefined && ledger.paretoEfficiency !== undefined) {
    details.push(
      `Multi-issue: trades ${ledger.tradesAccepted ?? 0}/${ledger.tradesProposed ?? 0} accepted · joint surplus ${ledger.jointSurplusFinal ?? 0}/${ledger.maxJointSurplus} → Pareto efficiency ${Math.round(ledger.paretoEfficiency * 100)}%`,
    );
  }

  return { bqs: Math.min(100, bqs), components: { decisionQuality: dq, surplusCapture: sc, diligenceCoverage: dci, processDiscipline: pd.score }, processChecklist: pd.checklist, decisionCorrect: correct, details };
}
