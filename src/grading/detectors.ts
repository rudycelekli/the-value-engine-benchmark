/**
 * Failure-mode detectors.
 *
 * (a) `detectDeterministicFailures` — a pure pass over the persisted episode
 *     (state, action/event log, buyer meters, walk-aways) that fires the
 *     mechanically-detectable modes with numeric/week/turn evidence. No LLM.
 * (b) `detectJudgeModesHeuristically` — the mock/offline stand-in for the
 *     LLM judge's failure-mode pass: regex/log heuristics whose evidence
 *     still cites REAL transcript turns (turnIndex + verbatim quote), so the
 *     citation contract holds in mock mode too.
 */

import type { Episode, Scenario, TranscriptEvent, Turn } from '../types.js';
import { detect, mergeDetections, type DetectedFailure, type FailureEvidence } from './taxonomy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WHY_NOW_RE = /budget|lock|deadline|renew|quarter|window|consent|checkpoint|fiscal|expir/i;
const PAPER_RE = /procurement|legal|security review|tprm|mrm|msa|vendor (risk|management|onboarding)|paper process|redlin/i;

function snip(s: string, n = 160): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function ev(detail: string, e?: { turnIndex?: number; week?: number; quote?: string }): FailureEvidence {
  return { detail, ...e };
}

function cite(t: Turn, detail: string): FailureEvidence {
  return { detail, turnIndex: t.index, week: t.week, quote: snip(t.content) };
}

function behaviorEvents(episode: Episode, name: string): TranscriptEvent[] {
  return episode.events.filter((e) => e.type === 'behavior_detected' && e.detail.split(/,\s*/).some((d) => d.startsWith(name)));
}

// ---------------------------------------------------------------------------
// (a) Deterministic pass
// ---------------------------------------------------------------------------

export function detectDeterministicFailures(episode: Episode, scenario: Scenario): DetectedFailure[] {
  const { events, signals, turns, finalState: st } = episode;
  const released = new Set(st.releasedFactIds);
  const found: Array<DetectedFailure | undefined> = [];

  const sellerCallTurns = turns.filter((t) => t.actor === 'seller' && t.kind === 'call_turn');
  const buyerCallTurns = turns.filter((t) => t.actor === 'buyer' && t.kind === 'call_turn');

  // -- discovery -------------------------------------------------------------
  const pitchEvents = behaviorEvents(episode, 'pitch');
  const firstQuant = behaviorEvents(episode, 'quantifying_question')[0];
  const earlyPitches = pitchEvents.filter((p) => !firstQuant || p.turnIndex < firstQuant.turnIndex);
  if (earlyPitches.length > 0) {
    found.push(
      detect('premature-pitch', [
        ev(
          `${earlyPitches.length} pitch(es) before the first quantifying question${firstQuant ? '' : ' (which never came)'} — first at week ${earlyPitches[0].week}, turn ${earlyPitches[0].turnIndex}.`,
          { turnIndex: earlyPitches[0].turnIndex, week: earlyPitches[0].week },
        ),
      ]),
    );
  }

  if (signals.openDiscoveryQuestions + signals.quantifyingQuestions === 0) {
    found.push(detect('no-open-questions', [ev(`0 open discovery questions and 0 quantifying questions across ${sellerCallTurns.length} seller call turns.`)]));
  }

  const quantFacts = scenario.gated_facts.filter((g) => g.gate === 'quantifying_question');
  if (quantFacts.length > 0 && !quantFacts.some((g) => released.has(g.id))) {
    found.push(
      detect('failed-quantification', [
        ev(`The scenario held ${quantFacts.length} quantified-pain fact(s) (${quantFacts.map((g) => g.id).join(', ')}); none were earned. Quantifying questions asked: ${signals.quantifyingQuestions}.`),
      ]),
    );
  }

  const whyNowFacts = scenario.gated_facts.filter((g) => WHY_NOW_RE.test(g.fact) || WHY_NOW_RE.test(g.id));
  const missedWhyNow = whyNowFacts.filter((g) => !released.has(g.id));
  if (whyNowFacts.length > 0 && missedWhyNow.length === whyNowFacts.length) {
    found.push(
      detect('missed-compelling-event', [
        ev(`Compelling-event fact(s) never surfaced: ${missedWhyNow.map((g) => g.id).join(', ')}. The Why-Now stayed buried for all ${scenario.calendar.weeks} weeks.`),
      ]),
    );
  }

  // -- stakeholders ------------------------------------------------------------
  if (!st.ebMeetingHeld) {
    const eb = scenario.personas.find((p) => p.is_economic_buyer);
    found.push(detect('never-reached-eb', [ev(`No EB meeting was ever held${eb ? ` (${eb.name}, ${eb.role})` : ''}. EB meeting requested: ${signals.ebMeetingRequested}.`)]));
  }

  const hasChampionCandidate = scenario.personas.some((p) => p.committee_role === 'champion_candidate' || p.is_initial_contact);
  if (hasChampionCandidate && signals.championTests === 0) {
    found.push(detect('champion-untested', [ev(`0 champion-test asks across the episode — the contact was never asked for anything with internal cost.`)]));
  }

  const engagedPersonas = new Set<string>(turns.filter((t) => t.actor === 'buyer' && t.personaId).map((t) => t.personaId as string));
  if (scenario.personas.length > 1 && engagedPersonas.size <= 1) {
    found.push(
      detect('single-threaded', [
        ev(`Engaged ${engagedPersonas.size}/${scenario.personas.length} stakeholders (${[...engagedPersonas].join(', ') || 'none'}) in a multi-persona account.`),
      ]),
    );
  }

  // -- price ---------------------------------------------------------------------
  const discountEvents = events.filter((e) => e.type === 'discount_conceded');
  const procurementWeek = scenario.events.find((e) => e.effect === 'procurement_enters')?.week;
  const unforced = discountEvents.filter((e) => procurementWeek === undefined || e.week < procurementWeek);
  if (unforced.length > 0) {
    const pcts = unforced.map((e) => `${(e.data?.pct as number) ?? '?'}% (wk${e.week}, t${e.turnIndex})`);
    found.push(detect('unforced-discount', [ev(`Discount offered before any procurement pressure${procurementWeek !== undefined ? ` (procurement enters wk${procurementWeek})` : ' (no procurement event exists)'}: ${pcts.join(', ')}.`)]));
  }

  const maxOk = scenario.win_conditions.max_discount_pct;
  if (st.discountConcededPct > maxOk) {
    found.push(detect('discount-beyond-tolerance', [ev(`Conceded ${st.discountConcededPct}% against a ${maxOk}% deal tolerance.`)]));
  }

  if (procurementWeek !== undefined) {
    const panic = discountEvents.filter((e) => e.week >= procurementWeek && e.week <= procurementWeek + 1);
    if (panic.length > 0) {
      found.push(
        detect('price-panic-under-procurement', [
          ev(`Discount conceded within a week of procurement entering (wk${procurementWeek}): ${panic.map((e) => `${(e.data?.pct as number) ?? '?'}% at wk${e.week}, t${e.turnIndex}`).join(', ')}.`),
        ]),
      );
    }
  }

  // -- process ---------------------------------------------------------------------
  if (!signals.mapProposed) {
    found.push(detect('no-mutual-action-plan', [ev(`No mutual action plan was ever proposed (win conditions require a MAP: ${scenario.win_conditions.requires_map}).`)]));
  } else if (!st.mapAcknowledged) {
    found.push(detect('unconfirmed-close-plan', [ev(`A MAP was proposed but the buyer never acknowledged its dates.`)]));
  }

  const DATED_RE = /\b(monday|tuesday|wednesday|thursday|friday|next week|this week|by (end of )?(week|month|friday|quarter)|week \d|(within|in) (\d+|a|one|two|three|four|five) (business )?(days?|weeks?)|timeline with dates|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i;
  const sellerOutbound = turns.filter((t) => t.actor === 'seller' && t.kind !== 'internal_planning');
  if (sellerOutbound.length > 0 && !sellerOutbound.some((t) => DATED_RE.test(t.content))) {
    found.push(detect('no-dated-next-step', [ev(`None of the seller's ${sellerOutbound.length} outbound turns proposed a dated next step.`)]));
  }

  // -- adaptability -----------------------------------------------------------------
  if (scenario.competitor && signals.competitorProbes === 0) {
    found.push(detect('no-competitive-response', [ev(`${scenario.competitor.name} was in the account (${scenario.competitor.product}); the seller made 0 competitor probes.`)]));
  }

  // Curveball collapse: sum trust deltas from meter_change events in [event week, week+1].
  const triggered = events.filter((e) => e.type === 'event_triggered');
  for (const tr of triggered) {
    let trustDrop = 0;
    let interestDrop = 0;
    for (const mc of events.filter((e) => e.type === 'meter_change' && e.week >= tr.week && e.week <= tr.week + 1)) {
      const tm = mc.detail.match(/trust ([+-]\d+)/);
      const im = mc.detail.match(/interest ([+-]\d+)/);
      if (tm) trustDrop += Math.min(0, Number(tm[1]));
      if (im) interestDrop += Math.min(0, Number(im[1]));
    }
    if (trustDrop <= -12 || interestDrop <= -12) {
      found.push(
        detect('curveball-collapse', [
          ev(`After "${snip(tr.detail, 80)}" (wk${tr.week}), trust moved ${trustDrop} and interest ${interestDrop} within the following week.`, { week: tr.week }),
        ]),
      );
      break; // one firing per run is enough; evidence names the worst event first
    }
  }

  // -- integrity ---------------------------------------------------------------------
  const contradictions = behaviorEvents(episode, 'factual_contradiction');
  if (contradictions.length > 0) {
    found.push(
      detect('contradicted-own-claim', contradictions.slice(0, 3).map((c) => {
        const t = turns[c.turnIndex];
        return t ? cite(t, `Factual contradiction detected at wk${c.week}.`) : ev(`Factual contradiction detected at wk${c.week}, turn ${c.turnIndex}.`, { turnIndex: c.turnIndex, week: c.week });
      })),
    );
  }

  // -- efficiency ----------------------------------------------------------------------
  if (sellerCallTurns.length >= 3 && buyerCallTurns.length >= 3) {
    const avg = (ts: Turn[]) => ts.reduce((a, t) => a + t.content.length, 0) / ts.length;
    const sAvg = Math.round(avg(sellerCallTurns));
    const bAvg = Math.round(avg(buyerCallTurns));
    if (sAvg > 400 && sAvg > bAvg * 2.2) {
      found.push(detect('monologuing', [ev(`Average seller call turn ${sAvg} chars vs buyer ${bAvg} chars (${(sAvg / bAvg).toFixed(1)}×) — the seller did the talking.`)]));
    }
  }

  const wasted = behaviorEvents(episode, 'wasted_meeting');
  if (wasted.length > 0) {
    found.push(detect('meeting-waste', [ev(`${wasted.length} meeting(s) earned zero gated facts and exchanged zero value (weeks ${wasted.map((w) => w.week).join(', ')}).`)]));
  }

  if (turns.some((t) => t.actor === 'system' && /touch budget.*exhausted/i.test(t.content))) {
    found.push(detect('touch-budget-burnout', [ev(`Episode touch budget (${scenario.calendar.touch_budget ?? '?'}) was exhausted before the calendar ran out.`)]));
  }

  for (const [personaId, m] of Object.entries(st.personaMeters ?? {})) {
    if (!m.walkedAway) continue;
    const modeId =
      m.walkedAway === 'polite_no'
        ? 'stakeholder-walked-polite-no'
        : m.walkedAway === 'went_with_incumbent'
          ? 'stakeholder-walked-incumbent'
          : 'stakeholder-walked-ghost';
    const persona = scenario.personas.find((p) => p.id === personaId);
    found.push(detect(modeId, [ev(`${persona?.name ?? personaId} walked away (${m.walkedAway}) in week ${m.walkedAwayWeek ?? '?'} — permanent.`, { week: m.walkedAwayWeek })]));
  }

  return mergeDetections(found);
}

// ---------------------------------------------------------------------------
// (b) Heuristic judge-mode pass (mock mode / LLM fallback)
// ---------------------------------------------------------------------------

export function detectJudgeModesHeuristically(episode: Episode, scenario: Scenario): DetectedFailure[] {
  const { turns, events, signals, finalState: st } = episode;
  const released = new Set(st.releasedFactIds);
  const found: Array<DetectedFailure | undefined> = [];

  const sellerTurns = turns.filter((t) => t.actor === 'seller' && t.kind !== 'internal_planning');
  const buyerTurns = turns.filter((t) => t.actor === 'buyer');
  const firstSellerCall = sellerTurns.find((t) => t.kind === 'call_turn');

  // no-pain-owner-identified: no quantified pain was ever earned in anyone's name.
  const quantFacts = scenario.gated_facts.filter((g) => g.gate === 'quantifying_question');
  if (quantFacts.length > 0 && !quantFacts.some((g) => released.has(g.id)) && firstSellerCall) {
    found.push(detect('no-pain-owner-identified', [cite(firstSellerCall, 'No pain number with a named owner was ever earned; discovery opened like this instead.')]));
  }

  // shallow-implication: a pain number was earned but the seller never played it back into cost.
  const earnedQuant = quantFacts.filter((g) => released.has(g.id));
  if (earnedQuant.length > 0) {
    const numbers = earnedQuant.map((g) => g.fact.match(/\$[\d,.]+\s?[MKmk]?|\d+(,\d{3})*(\.\d+)?%?/)?.[0]).filter(Boolean) as string[];
    const playedBack = sellerTurns.some((t) => numbers.some((n) => t.content.includes(n)) || /cost of delay|per (month|week|year) of delay/i.test(t.content));
    if (!playedBack) {
      const rel = events.find((e) => e.type === 'fact_released' && earnedQuant.some((g) => g.id === e.data?.factId));
      const after = rel ? sellerTurns.find((t) => t.index > rel.turnIndex) : undefined;
      if (after) found.push(detect('shallow-implication', [cite(after, `The buyer volunteered ${numbers.join(' / ') || 'a pain number'}; the seller never linked it to business cost.`)]));
    }
  }

  // ignored-blocker: a blocker persona is active/known but never addressed by the seller.
  const blocker = scenario.personas.find((p) => p.committee_role === 'blocker');
  if (blocker && st.activePersonaIds.includes(blocker.id)) {
    const addressed = sellerTurns.some((t) => t.content.includes(blocker.name.split(' ')[0])) || turns.some((t) => t.actor === 'buyer' && t.personaId === blocker.id);
    const blockerTurn = buyerTurns.find((t) => t.personaId === blocker.id);
    if (!addressed && firstSellerCall) {
      found.push(detect('ignored-blocker', [cite(blockerTurn ?? firstSellerCall, `${blocker.name} (${blocker.role}) was reachable and invested in the status quo; the seller never engaged them.`)]));
    }
  }

  // evidence-not-offered: buyer skepticism followed by an evidence-free seller reply.
  const skepticism = buyerTurns.find((t) => /skeptic|not convinced|prove|why should|whose number|up to.*claims|sounds like every vendor/i.test(t.content));
  if (skepticism) {
    const reply = sellerTurns.find((t) => t.index > skepticism.index);
    if (reply && !/case study|customer|reference|benchmark|pilot|data|\d/.test(reply.content)) {
      found.push(detect('evidence-not-offered', [cite(skepticism, 'Buyer skepticism...'), cite(reply, '...met with assertion, not evidence.')]));
    }
  }

  // argued-with-buyer
  const argued = sellerTurns.find((t) => /you'?re (wrong|mistaken)|that'?s (just )?not true|no, actually|i disagree|with respect, that'?s/i.test(t.content));
  if (argued) found.push(detect('argued-with-buyer', [cite(argued, 'The seller contradicted the buyer head-on instead of exploring the objection.')]));

  // capitulated-on-first-pushback: first discount within 3 turns of the first buyer price pushback.
  const pushback = buyerTurns.find((t) => /too expensive|cheaper|price|discount|\$\d+k|budget doesn'?t/i.test(t.content));
  const firstDiscount = events.find((e) => e.type === 'discount_conceded');
  if (pushback && firstDiscount && firstDiscount.turnIndex > pushback.index && firstDiscount.turnIndex - pushback.index <= 3) {
    const dTurn = turns[firstDiscount.turnIndex];
    if (dTurn) {
      found.push(detect('capitulated-on-first-pushback', [cite(pushback, 'First price pushback...'), cite(dTurn, `...answered with an immediate ${(firstDiscount.data?.pct as number) ?? '?'}% concession.`)]));
    }
  }

  // ignored-paper-process: buyer raised paper actors; seller never engaged them.
  const paperTurn = buyerTurns.find((t) => PAPER_RE.test(t.content));
  if (paperTurn && !sellerTurns.some((t) => t.index > paperTurn.index && PAPER_RE.test(t.content))) {
    found.push(detect('ignored-paper-process', [cite(paperTurn, 'The buyer raised the paper process; the seller never mapped or engaged it.')]));
  }

  // ignored-mid-cycle-event: a scheduled event fired; no seller turn afterwards reflects it.
  const EVENT_KEYWORDS: Record<string, RegExp> = {
    champion_goes_quiet: /quiet|busy|no rush|when you'?re back|one[- ]pager|useful|checking in with something/i,
    procurement_enters: /procurement|trade|multi[- ]year|value|concession|terms/i,
    competitor_push: /trakonic|incumbent|alternative|compare|differen/i,
    budget_scrutiny: /business case|cfo|model|payback|roi|conservative/i,
    reorg_rumor: /reorg|change|transition|priorit/i,
  };
  for (const trg of events.filter((e) => e.type === 'event_triggered')) {
    const effect = scenario.events.find((se) => trg.detail.startsWith(se.id))?.effect;
    const re = effect ? EVENT_KEYWORDS[effect] : undefined;
    if (!re) continue;
    const after = sellerTurns.filter((t) => t.week >= trg.week);
    if (after.length > 0 && !after.some((t) => re.test(t.content))) {
      found.push(detect('ignored-mid-cycle-event', [cite(after[0], `Event "${snip(trg.detail, 70)}" (wk${trg.week}) changed the deal; the seller's subsequent turns never acknowledged it.`)]));
      break;
    }
  }

  // lost-thread-across-calls: a factual contradiction in a later week than the first call.
  const firstCallWeek = turns.find((t) => t.kind === 'call_turn')?.week ?? 1;
  const lateContradiction = events.find((e) => e.type === 'behavior_detected' && e.detail.includes('factual_contradiction') && e.week > firstCallWeek);
  if (lateContradiction) {
    const t = turns[lateContradiction.turnIndex];
    if (t) found.push(detect('lost-thread-across-calls', [cite(t, `Contradicted a fact established in an earlier call (wk${firstCallWeek} → wk${lateContradiction.week}).`)]));
  }

  // fabricated-buyer-quote: seller attributes quoted words the buyer never said.
  for (const t of sellerTurns) {
    const m = t.content.match(/you (said|mentioned|told me)[^"“]*["“]([^"”]{12,})["”]/i);
    if (!m) continue;
    const quoted = m[2].toLowerCase();
    const buyerSaidIt = buyerTurns.some((b) => b.index < t.index && b.content.toLowerCase().includes(quoted.slice(0, 40)));
    if (!buyerSaidIt) {
      found.push(detect('fabricated-buyer-quote', [cite(t, 'Attributed quoted words to the buyer that appear nowhere in the buyer\'s prior turns.')]));
      break;
    }
  }

  // hallucinated-capability is intentionally LLM-judge-only: the heuristic has
  // no ground truth for the product's real capability envelope.

  return mergeDetections(found);
}
