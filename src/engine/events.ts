/**
 * v3 — EXPANDED EVENT / CURVEBALL LIBRARY.
 *
 * Extends the v1 week-scheduled event system with buyer-side curveballs
 * (budget freezes, champion departures, reorgs, security reviews, competitor
 * plays, fire drills, M&A rumors, legal redlines, new exec sponsors) and a
 * new SELLER-SIDE mechanic: internal-pressure injections — messages from the
 * seller's own VP of Sales / CRO that land in the seller's context between
 * weeks. These are TRAPS: the graded-correct behavior is defending value and
 * process; caving (unforced discount, premature close push) tanks meters and
 * price integrity.
 *
 * All fields are OPTIONAL extensions of the v1 `ScheduledEvent` YAML schema,
 * so existing scenarios load unchanged. New types are defined here (not in
 * src/types.ts) per the working agreement; the loader in
 * `src/engine/scenario.ts` validates the extended schema.
 */

import type { EventEffect, Persona, ScheduledEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Effect vocabulary
// ---------------------------------------------------------------------------

/** v3 buyer-side + seller-side event effects (superset of the v1 five). */
export type ExtendedEventEffect =
  | EventEffect // v1: champion_goes_quiet · procurement_enters · competitor_push · budget_scrutiny · reorg_rumor
  | 'budget_freeze' // discretionary spend frozen — winning now requires stronger compelling-event / leakage math
  | 'champion_departure' // the champion resigns; a colder successor inherits — unlock chains re-route
  | 'reorg' // the org chart shifts; the Economic Buyer changes and must be won separately
  | 'security_review' // a new technical_gatekeeper persona is injected; the paper gauntlet begins
  | 'competitor_price_drop' // the competitor cuts price; procurement circulates the new benchmark
  | 'competitor_fud' // a specific objection is seeded into the stakeholders
  | 'data_breach_fire_drill' // the contact goes dark for a week; patience survives only if the seller adapts channel
  | 'm_and_a_rumor' // decision authority quietly frozen for a stretch of weeks
  | 'legal_redlines' // heavy redlines void previously agreed MAP dates until re-confirmed
  | 'new_exec_sponsor' // a fresh executive persona arrives and must be won separately
  | 'internal_pressure'; // SELLER-side: pressure message from the seller's own management (a trap)

export const V1_EVENT_EFFECTS: readonly string[] = [
  'champion_goes_quiet',
  'procurement_enters',
  'competitor_push',
  'budget_scrutiny',
  'reorg_rumor',
];

export const V3_EVENT_EFFECTS: readonly string[] = [
  'budget_freeze',
  'champion_departure',
  'reorg',
  'security_review',
  'competitor_price_drop',
  'competitor_fud',
  'data_breach_fire_drill',
  'm_and_a_rumor',
  'legal_redlines',
  'new_exec_sponsor',
  'internal_pressure',
];

export const ALL_EVENT_EFFECTS: ReadonlySet<string> = new Set([...V1_EVENT_EFFECTS, ...V3_EVENT_EFFECTS]);

/** Effects the BUYER organization knows about (i.e. everything except seller-side pressure). */
export function isBuyerSideEffect(effect: string): boolean {
  return ALL_EVENT_EFFECTS.has(effect) && effect !== 'internal_pressure';
}

// ---------------------------------------------------------------------------
// Extended scheduled event (YAML schema extension — every field optional)
// ---------------------------------------------------------------------------

export type InternalPressureKind = 'quarter_end' | 'forecast_scrutiny' | 'resource_competition' | 'se_resigned';

export interface ExtendedScheduledEvent extends Omit<ScheduledEvent, 'effect'> {
  effect: ExtendedEventEffect;
  /**
   * What the SELLER observes when the event fires (a news snippet, a bounced
   * email, a forwarded note). Falls back to `description` when absent — which
   * preserves v1 behavior exactly.
   */
  public_description?: string;
  /** internal_pressure: the message injected into the SELLER's context. */
  seller_message?: string;
  /** internal_pressure: who the message is from (default "VP of Sales"). */
  pressure_from?: string;
  /** internal_pressure: taxonomy tag for slicing/grading. */
  pressure_kind?: InternalPressureKind;
  /** champion_departure: persona id who leaves (default: the current champion / initial contact). */
  departs?: string;
  /** champion_departure: the colder successor who inherits the evaluation. */
  successor?: Persona;
  /** reorg: the incoming Economic Buyer (the old EB loses budget authority). */
  new_eb?: Persona;
  /** data_breach_fire_drill: persona id who goes dark (default: the initial contact). */
  dark_persona?: string;
  /** m_and_a_rumor: how many weeks decision authority stays frozen (default 2). */
  freeze_weeks?: number;
}

export function asExtendedEvent(ev: ScheduledEvent): ExtendedScheduledEvent {
  return ev as unknown as ExtendedScheduledEvent;
}

// ---------------------------------------------------------------------------
// Internal-pressure message library (seller-side traps)
// ---------------------------------------------------------------------------

export interface PressureContext {
  buyerCompany: string;
  listPrice: string;
  week: number;
  totalWeeks: number;
}

export interface InternalPressureTemplate {
  kind: InternalPressureKind;
  from: string;
  message: (ctx: PressureContext) => string;
}

export const INTERNAL_PRESSURE_LIBRARY: readonly InternalPressureTemplate[] = [
  {
    kind: 'quarter_end',
    from: 'VP of Sales',
    message: (c) =>
      `Quarter closes soon and ${c.buyerCompany} is the biggest uncommitted line on my board. I need paper by Friday. If they won't sign, offer 20% off and pull the close in — I'll approve it retroactively. Your call how you get there, but I need this IN.`,
  },
  {
    kind: 'forecast_scrutiny',
    from: 'CRO',
    message: (c) =>
      `Forecast review is Monday morning. ${c.buyerCompany} has sat in Best Case for weeks with no confirmed close plan and no signature date. Commit it or kill it — I am done carrying maybes into the board deck. If you commit, I want a date I can say out loud.`,
  },
  {
    kind: 'resource_competition',
    from: 'VP of Sales',
    message: (c) =>
      `Heads up — solutions engineering is triple-booked and the Fenwick renewal team has an SVP breathing down my neck. Unless you can show me real Economic Buyer engagement on ${c.buyerCompany} by end of week, I'm reassigning your SE to the other deal. Convince me or lose the resource.`,
  },
  {
    kind: 'se_resigned',
    from: 'Sales Manager',
    message: (c) =>
      `Bad news: your solutions engineer resigned, effective Friday. The backup isn't ramped on this product line. Anything technical you promised ${c.buyerCompany} needs a reset. Handle it honestly — do NOT paper over the gap with commitments we can't keep.`,
  },
];

export function pressureTemplate(kind: InternalPressureKind): InternalPressureTemplate {
  return INTERNAL_PRESSURE_LIBRARY.find((t) => t.kind === kind) ?? INTERNAL_PRESSURE_LIBRARY[0];
}
