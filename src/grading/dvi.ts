/**
 * DVI scoring math — verified against the author's Excel workbook
 * (The Value Engine Live Workbook).
 *
 * Weights (book Ch. 13, Figure 7): MEDDPICC 40 · 3 Whys 20 · EB 15 · MAP 15 ·
 * Champion 10. Bands: 75+ Commit-eligible · 50–74 develop · <50 rebuild.
 */

import type { MeddpiccKey } from '../types.js';

export const LETTERS: ReadonlyArray<{ key: MeddpiccKey; label: string; gold: string; action: string }> = [
  { key: 'metrics', label: 'M — Metrics', gold: 'A written, customer-validated value model with baseline and target numbers', action: "Co-draft the before/after value model with the customer's own numbers; get ops or finance to validate the baseline." },
  { key: 'economic_buyer', label: 'E — Economic Buyer', gold: "You have met the EB; they can articulate the case; they've committed to a decision process", action: 'Get the champion to secure the EB meeting; earn it with insight, not persistence. No EB, no POV.' },
  { key: 'decision_criteria', label: 'D — Decision Criteria', gold: 'Written criteria that include your differentiators — because you helped shape them', action: "Run trap-setting now: seed your differentiators into the customer's emerging written criteria before the bake-off." },
  { key: 'decision_process', label: 'D — Decision Process', gold: 'A documented map of steps, owners, and dates the champion validated', action: 'Have the champion walk you through every step, owner, and date; write it down and get it corrected.' },
  { key: 'paper_process', label: 'P — Paper Process', gold: 'MSA and security review started in parallel with validation, not after', action: 'Map legal, security, procurement, and vendor onboarding with owners and durations; start paper in parallel this week.' },
  { key: 'identified_pain', label: 'I — Identified Pain', gold: 'Pain with a named owner, quantified impact, stakeholder quotes', action: 'Run an A.X.I.O.M. loop to Impact: get the number, the named owner, and a verbatim quote.' },
  { key: 'champion', label: 'C — Champion', gold: 'Tested: secured meetings, shared intel, defended you under pressure', action: 'Test the champion with an ask that has internal cost — an EB introduction, org intel, a business-case rehearsal.' },
  { key: 'competition', label: 'C — Competition', gold: 'You know the primary competitor, their champion, and your trap strategy', action: 'Map every alternative — rivals, internal build, status quo — find their internal sponsor, and set traps on your differentiation.' },
] as const;

export type MeddpiccScores = Record<MeddpiccKey, number>;

/** Verbatim from mcp-server `meddpiccRollup`. */
export function meddpiccRollup(scores: MeddpiccScores) {
  const sum = LETTERS.reduce((acc, l) => acc + scores[l.key], 0);
  const points = Math.round((sum / 24) * 40 * 10) / 10;
  const min = Math.min(...LETTERS.map((l) => scores[l.key]));
  const lowest = LETTERS.filter((l) => scores[l.key] === min);
  return { sum, points, min, lowest };
}

export interface WhyFlags {
  customer_words: boolean;
  named_owner: boolean;
  number_attached: boolean;
}

export interface DviInput {
  meddpicc: MeddpiccScores;
  three_whys: {
    why_anything: WhyFlags;
    why_us: WhyFlags;
    why_now: WhyFlags;
  };
  eb_engagement: 'never_met' | 'meeting_scheduled' | 'attended_with_conditional_commitment';
  map_dates_confirmed_pct: number; // 0–100
  champion: 'none' | 'coach_only' | 'untested_champion' | 'tested_champion';
}

export interface DviResult {
  total: number;
  band: string;
  components: {
    meddpicc: number;
    threeWhys: number;
    ebEngagement: number;
    mapDates: number;
    champion: number;
  };
  meddpiccSum: number;
  lowestLetter: string;
  lowestLetterScore: number;
  whyLines: string[];
  integrityFlags: string[];
  prioritizedActions: string[];
}

/**
 * Component roll-up copied line-for-line (logic) from mcp-server `score_dvi`:
 * 3 Whys 7/7/6 scaled by evidenced fields; EB 0/8/15; MAP pct × 15;
 * champion 0/3/6/10; bands at 75 and 50.
 */
export function computeDvi(input: DviInput): DviResult {
  const m = meddpiccRollup(input.meddpicc);

  const whyMax: Record<string, number> = { why_anything: 7, why_us: 7, why_now: 6 };
  let whys = 0;
  const whyLines: string[] = [];
  for (const [name, flags] of Object.entries(input.three_whys) as [string, WhyFlags][]) {
    const met = [flags.customer_words, flags.named_owner, flags.number_attached].filter(Boolean).length;
    const pts = Math.round(((met / 3) * whyMax[name]) * 10) / 10;
    whys += pts;
    const missing = [
      !flags.customer_words && "customer's own words",
      !flags.named_owner && 'named owner',
      !flags.number_attached && 'the number',
    ].filter(Boolean);
    whyLines.push(`- ${name.replace(/_/g, ' ')}: ${pts}/${whyMax[name]}${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  }
  whys = Math.round(whys * 10) / 10;

  const ebPts = { never_met: 0, meeting_scheduled: 8, attended_with_conditional_commitment: 15 }[input.eb_engagement];
  const mapPts = Math.round((input.map_dates_confirmed_pct / 100) * 15 * 10) / 10;
  const champPts = { none: 0, coach_only: 3, untested_champion: 6, tested_champion: 10 }[input.champion];

  const total = Math.round((m.points + whys + ebPts + mapPts + champPts) * 10) / 10;
  const band =
    total >= 75
      ? 'COMMIT-ELIGIBLE — verify no letter <2 and MAP confirmed'
      : total >= 50
        ? 'DEVELOP — work the lowest component this week'
        : 'REBUILD THE CASE';

  const integrityFlags: string[] = [];
  if (m.min < 2) {
    integrityFlags.push(`FLAG — MEDDPICC letter below 2 (${m.lowest.map((l) => l.label).join(', ')}). Write the dated action plan.`);
  }

  const prioritizedActions: string[] = [];
  for (const l of LETTERS) {
    if (input.meddpicc[l.key] < 2) prioritizedActions.push(`[${l.label}, scored ${input.meddpicc[l.key]}] ${l.action}`);
  }
  const components: Array<[string, number, number, string]> = [
    ['MEDDPICC evidence', m.points, 40, `Work the lowest letter (${m.lowest.map((l) => l.label).join(', ')}).`],
    ['3 Whys clarity', whys, 20, "Rewrite each Why in the customer's own words with a named owner and a number; capture a verbatim quote."],
    ['EB engagement', ebPts, 15, input.eb_engagement === 'never_met' ? 'Get the champion to secure the EB meeting — no EB, no POV.' : 'Hold the EB meeting and secure the conditional commitment, confirmed in writing.'],
    ['MAP dates confirmed', mapPts, 15, "Introduce/refresh the MAP working backward from the customer's go-live; get the next 30 days of dates confirmed in writing."],
    ['Champion strength', champPts, 10, 'Test the champion with an ask that has internal cost (EB intro, intel, business-case rehearsal).'],
  ];
  components.sort((a, b) => a[1] / a[2] - b[1] / b[2]);
  for (const [name, pts, max, action] of components) {
    if (pts < max) prioritizedActions.push(`[${name}: ${pts}/${max}] ${action}`);
  }

  return {
    total,
    band,
    components: { meddpicc: m.points, threeWhys: whys, ebEngagement: ebPts, mapDates: mapPts, champion: champPts },
    meddpiccSum: m.sum,
    lowestLetter: m.lowest.map((l) => l.label).join(', '),
    lowestLetterScore: m.min,
    whyLines,
    integrityFlags,
    prioritizedActions,
  };
}
