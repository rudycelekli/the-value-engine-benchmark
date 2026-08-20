/**
 * Canonical failure-mode taxonomy for The Value Engine Benchmark.
 *
 * Purpose: turn a scored run into a DIAGNOSIS. Every mode is a specific,
 * recognizable way sellers break — mechanically detectable from the persisted
 * episode state/event log (`deterministic`) or requiring transcript reading
 * with a mandatory citation (`judge`). Aggregated across thousands of runs
 * these become a per-model strengths/weaknesses fingerprint.
 *
 * This module owns all NEW types for the diagnostic layer (src/types.ts is
 * frozen; do not move these there).
 */

import type { GradeReport } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureCategory =
  | 'discovery'
  | 'stakeholders'
  | 'objections'
  | 'price'
  | 'process'
  | 'adaptability'
  | 'integrity'
  | 'efficiency';

export type FailureSeverity = 'minor' | 'major' | 'critical';

/** Who can fire this mode: the deterministic log pass, or the judge (citation required). */
export type DetectionSource = 'deterministic' | 'judge';

export interface FailureModeDef {
  id: string;
  label: string;
  category: FailureCategory;
  severity: FailureSeverity;
  source: DetectionSource;
  description: string;
}

/** One piece of evidence for a detected failure. Judge-sourced evidence MUST carry turnIndex + quote. */
export interface FailureEvidence {
  detail: string;
  week?: number;
  turnIndex?: number;
  /** Verbatim transcript excerpt (required for judge-detected modes). */
  quote?: string;
}

export interface DetectedFailure {
  modeId: string;
  label: string;
  category: FailureCategory;
  severity: FailureSeverity;
  source: DetectionSource;
  evidence: FailureEvidence[];
}

/** Scenario metadata embedded at grade time so aggregation never needs the YAML. */
export interface ScenarioMeta {
  difficulty: number;
  industry?: string;
  salesMotion?: string;
  dealSizeBand?: string;
}

/** GradeReport + the diagnostic layer. Structurally a GradeReport, so all existing consumers keep working. */
export interface DiagnosticGradeReport extends GradeReport {
  failureModes: DetectedFailure[];
  scenarioMeta?: ScenarioMeta;
  /**
   * Honesty flag (Taiga `Grade.env_internal_failure` analog): true ONLY when
   * the grading INFRA failed (LLM judge exhausted retries) and the cell was
   * produced by the soft heuristic fallback anyway. Distinguishes "infra failed
   * to grade" from "model genuinely scored low" so downstream analytics can
   * exclude infra noise deterministically instead of string-matching
   * `judge=='heuristic'`. Absent/false on every clean cell.
   */
  envInternalFailure?: boolean;
  /** Retry-exhaustion error text(s) captured when `envInternalFailure` is set. */
  envInternalFailureLogs?: string[];
}

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

export const FAILURE_MODES: ReadonlyArray<FailureModeDef> = [
  // -- discovery ------------------------------------------------------------
  { id: 'premature-pitch', label: 'Premature pitch', category: 'discovery', severity: 'major', source: 'deterministic',
    description: 'Pitched product before earning a single quantified pain — led with the deck, not the discovery.' },
  { id: 'no-open-questions', label: 'No open questions', category: 'discovery', severity: 'major', source: 'deterministic',
    description: 'Ran the entire cycle without a single open discovery or quantifying question.' },
  { id: 'failed-quantification', label: 'Failed quantification', category: 'discovery', severity: 'critical', source: 'deterministic',
    description: 'Never earned the pain number — no quantifying-question-gated fact was ever released.' },
  { id: 'missed-compelling-event', label: 'Missed compelling event', category: 'discovery', severity: 'major', source: 'deterministic',
    description: 'The scenario held a genuine Why-Now (budget lock, deadline, renewal) and the seller never surfaced it.' },
  { id: 'no-pain-owner-identified', label: 'No pain owner identified', category: 'discovery', severity: 'major', source: 'judge',
    description: 'Pain discussed without ever attaching it to a named owner who reports the number.' },
  { id: 'shallow-implication', label: 'Shallow implication', category: 'discovery', severity: 'major', source: 'judge',
    description: 'Heard the pain but never linked it to business cost — the Impact step of A.X.I.O.M. was skipped.' },

  // -- stakeholders ----------------------------------------------------------
  { id: 'never-reached-eb', label: 'Never reached the EB', category: 'stakeholders', severity: 'critical', source: 'deterministic',
    description: 'The Economic Buyer never attended a meeting. No EB, no deal.' },
  { id: 'champion-untested', label: 'Champion untested', category: 'stakeholders', severity: 'major', source: 'deterministic',
    description: 'Never made a champion-test ask with internal cost (EB intro, org intel, rehearsal).' },
  { id: 'single-threaded', label: 'Single-threaded', category: 'stakeholders', severity: 'major', source: 'deterministic',
    description: 'Engaged only one stakeholder in a multi-persona account — the deal hangs on one thread.' },
  { id: 'ignored-blocker', label: 'Ignored the blocker', category: 'stakeholders', severity: 'major', source: 'judge',
    description: 'A known blocker was active in the committee and the seller never engaged or neutralized them.' },
  { id: 'misread-committee-role', label: 'Misread committee role', category: 'stakeholders', severity: 'minor', source: 'judge',
    description: 'Played the wrong motion at a stakeholder — e.g. negotiated price with a technical gatekeeper, pitched features at the EB.' },

  // -- objections -------------------------------------------------------------
  { id: 'evidence-not-offered', label: 'Evidence not offered', category: 'objections', severity: 'major', source: 'judge',
    description: 'Met buyer skepticism with assertion instead of evidence (data, references, customer proof).' },
  { id: 'argued-with-buyer', label: 'Argued with the buyer', category: 'objections', severity: 'major', source: 'judge',
    description: 'Contradicted or debated the buyer head-on instead of exploring the objection.' },
  { id: 'capitulated-on-first-pushback', label: 'Capitulated on first pushback', category: 'objections', severity: 'major', source: 'judge',
    description: 'Folded (discount, scope, retreat) at the first sign of resistance instead of holding the value line.' },

  // -- price -------------------------------------------------------------------
  { id: 'unforced-discount', label: 'Unforced discount', category: 'price', severity: 'major', source: 'deterministic',
    description: 'Offered a discount nobody asked for — before procurement or any price pressure existed.' },
  { id: 'discount-beyond-tolerance', label: 'Discount beyond tolerance', category: 'price', severity: 'critical', source: 'deterministic',
    description: 'Total concession exceeded the deal economics\' maximum tolerated discount.' },
  { id: 'price-panic-under-procurement', label: 'Price panic under procurement', category: 'price', severity: 'major', source: 'deterministic',
    description: 'Conceded a discount within days of procurement entering — gifted, not traded.' },

  // -- process -------------------------------------------------------------------
  { id: 'no-mutual-action-plan', label: 'No mutual action plan', category: 'process', severity: 'major', source: 'deterministic',
    description: 'Never proposed a MAP — the close plan lived only in the seller\'s head.' },
  { id: 'unconfirmed-close-plan', label: 'Unconfirmed close plan', category: 'process', severity: 'major', source: 'deterministic',
    description: 'A MAP was proposed but the buyer never acknowledged its dates.' },
  { id: 'no-dated-next-step', label: 'No dated next step', category: 'process', severity: 'minor', source: 'deterministic',
    description: 'Never proposed a concrete, dated next step in any interaction.' },
  { id: 'ignored-paper-process', label: 'Ignored the paper process', category: 'process', severity: 'major', source: 'judge',
    description: 'The buyer raised procurement/legal/security and the seller never mapped or engaged it — where enterprise deals die.' },

  // -- adaptability ------------------------------------------------------------------
  { id: 'ignored-mid-cycle-event', label: 'Ignored mid-cycle event', category: 'adaptability', severity: 'major', source: 'judge',
    description: 'A scheduled event reshaped the deal (champion quiet, procurement, competitor push) and the seller\'s behavior never changed.' },
  { id: 'no-competitive-response', label: 'No competitive response', category: 'adaptability', severity: 'major', source: 'deterministic',
    description: 'A competitor was in the account and the seller never once probed the alternatives.' },
  { id: 'lost-thread-across-calls', label: 'Lost the thread across calls', category: 'adaptability', severity: 'major', source: 'judge',
    description: 'Contradicted or forgot facts established in earlier calls — no cross-call memory.' },
  { id: 'curveball-collapse', label: 'Curveball collapse', category: 'adaptability', severity: 'critical', source: 'deterministic',
    description: 'Trust/interest cratered in the window after a scheduled event — the seller made a bad situation worse.' },

  // -- integrity ---------------------------------------------------------------------
  { id: 'hallucinated-capability', label: 'Hallucinated capability', category: 'integrity', severity: 'critical', source: 'judge',
    description: 'Claimed product capability, customers, or guarantees not supported by the seller brief.' },
  { id: 'fabricated-buyer-quote', label: 'Fabricated buyer quote', category: 'integrity', severity: 'critical', source: 'judge',
    description: 'Attributed words to the buyer that the buyer never said.' },
  { id: 'contradicted-own-claim', label: 'Contradicted own claim', category: 'integrity', severity: 'major', source: 'deterministic',
    description: 'The state machine caught the seller factually contradicting something they said earlier.' },

  // -- efficiency ----------------------------------------------------------------------
  { id: 'monologuing', label: 'Monologuing', category: 'efficiency', severity: 'minor', source: 'deterministic',
    description: 'Average seller call turn vastly longer than the buyer\'s — talking, not selling.' },
  { id: 'meeting-waste', label: 'Meeting waste', category: 'efficiency', severity: 'minor', source: 'deterministic',
    description: 'Held meetings that earned zero gated facts and exchanged zero value.' },
  { id: 'touch-budget-burnout', label: 'Touch-budget burnout', category: 'efficiency', severity: 'major', source: 'deterministic',
    description: 'Exhausted the episode\'s outbound touch budget — spammed the account out of road.' },
  { id: 'stakeholder-walked-polite-no', label: 'Stakeholder walked (polite no)', category: 'efficiency', severity: 'minor', source: 'deterministic',
    description: 'A stakeholder ended it directly and finally — respected the seller enough to say no.' },
  { id: 'stakeholder-walked-incumbent', label: 'Stakeholder walked (went with incumbent)', category: 'efficiency', severity: 'major', source: 'deterministic',
    description: 'A stakeholder consolidated on the incumbent — the status quo was never displaced.' },
  { id: 'stakeholder-walked-ghost', label: 'Stakeholder walked (ghost)', category: 'efficiency', severity: 'critical', source: 'deterministic',
    description: 'A stakeholder ghosted — the seller burned the relationship completely.' },
] as const;

export const FAILURE_MODE_INDEX: ReadonlyMap<string, FailureModeDef> = new Map(
  FAILURE_MODES.map((m) => [m.id, m]),
);

export const CATEGORY_ORDER: ReadonlyArray<FailureCategory> = [
  'discovery',
  'stakeholders',
  'objections',
  'price',
  'process',
  'adaptability',
  'integrity',
  'efficiency',
];

export const SEVERITY_WEIGHT: Record<FailureSeverity, number> = { minor: 1, major: 2, critical: 3 };

/** Judge-sourced modes (the set the LLM judge is allowed to fire). */
export function judgeModes(): FailureModeDef[] {
  return FAILURE_MODES.filter((m) => m.source === 'judge');
}

/** Build a DetectedFailure from a mode id + evidence. Returns undefined for unknown ids. */
export function detect(modeId: string, evidence: FailureEvidence[]): DetectedFailure | undefined {
  const def = FAILURE_MODE_INDEX.get(modeId);
  if (!def || evidence.length === 0) return undefined;
  return {
    modeId: def.id,
    label: def.label,
    category: def.category,
    severity: def.severity,
    source: def.source,
    evidence,
  };
}

/** Merge detection lists, deduplicating by modeId (evidence concatenated). */
export function mergeDetections(
  ...lists: Array<Array<DetectedFailure | undefined>>
): DetectedFailure[] {
  const out = new Map<string, DetectedFailure>();
  for (const list of lists) {
    for (const d of list) {
      if (!d) continue;
      const existing = out.get(d.modeId);
      if (existing) existing.evidence.push(...d.evidence);
      else out.set(d.modeId, { ...d, evidence: [...d.evidence] });
    }
  }
  // Stable order: taxonomy order.
  const rank = new Map(FAILURE_MODES.map((m, i) => [m.id, i]));
  return [...out.values()].sort((a, b) => (rank.get(a.modeId) ?? 99) - (rank.get(b.modeId) ?? 99));
}
