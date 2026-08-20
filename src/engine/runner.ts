/**
 * Episode runner: advances the simulated calendar, alternates turns within
 * calls (bounded per call), routes emails, lets the seller plan between
 * touches, applies scheduled events, and terminates on win / loss /
 * buyer-goes-dark / walk-away / calendar-exhausted. Persists transcript +
 * action log.
 *
 * v2 additions:
 *  - committee calls: `request_meeting` may target several personas at once
 *    ("maya,theo") — each attendee keeps their own trust/interest/patience;
 *  - walk-away realism: the buyer is qualifying the seller; hard triggers
 *    (wasted meeting, premature pitch, dodged question, discount begging,
 *    contradictions) end the relationship PERMANENTLY, graded as a polite no,
 *    a ghost, or "went with the incumbent";
 *  - email realism: response latency scales with interest; low interest means
 *    no reply this week;
 *  - internal buyer-side channel: weekly Slack/email between stakeholders,
 *    hidden from the seller unless a high-trust champion forwards a thread;
 *    fully revealed in the grade report.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BehaviorSignals,
  Episode,
  EpisodeOutcome,
  InternalMessage,
  Scenario,
  SellerAction,
  TranscriptEvent,
  Turn,
} from '../types.js';
import { BuyerAgent } from '../buyer/index.js';
import { BuyerStateMachine } from '../buyer/state-machine.js';
import type { BuyerTranscript } from '../env/buyer-transcript.js';
import { asExtendedEvent } from './events.js';
import { generateInternalWeek, renderForward } from './internal-channel.js';
import type { SellerAdapter, SellerView } from '../seller/index.js';

const DEFAULT_NOTES_PER_WEEK = 3;
const DEFAULT_EMAILS_PER_WEEK = 3;

export interface RunOptions {
  scenario: Scenario;
  seller: SellerAdapter;
  pack: boolean;
  mock: boolean;
  runsDir: string;
  verbose?: boolean;
  /** Skip writing run artifacts to disk (calibration runs). */
  noPersist?: boolean;
  /**
   * Optional frozen buyer-sim hook. When present, buyer replies are captured
   * (record mode) or served verbatim (replay mode). Absent = unchanged.
   */
  transcript?: BuyerTranscript;
}

export async function runEpisode(opts: RunOptions): Promise<{ episode: Episode; runDir: string }> {
  const { scenario, seller, mock } = opts;
  const sm = new BuyerStateMachine(scenario);
  const buyer = new BuyerAgent(scenario, sm, mock, opts.transcript);
  const turns: Turn[] = [];
  const events: TranscriptEvent[] = [];
  const internalChannel: InternalMessage[] = [];
  const startedAt = new Date().toISOString();
  const log = (m: string) => opts.verbose && console.log(m);

  const maxNotes = scenario.calendar.notes_per_week ?? DEFAULT_NOTES_PER_WEEK;
  const maxEmails = scenario.calendar.emails_per_week ?? DEFAULT_EMAILS_PER_WEEK;
  let touchesUsed = 0; // emails + meeting requests, against the optional episode touch budget

  let outcome: EpisodeOutcome | undefined;

  const pushTurn = (t: Omit<Turn, 'index' | 'timestamp'>): Turn => {
    const turn: Turn = { ...t, index: turns.length, timestamp: new Date().toISOString() };
    turns.push(turn);
    log(`  [${turn.kind}] ${turn.actor}${turn.personaId ? `(${turn.personaId})` : ''}: ${turn.content.slice(0, 140)}`);
    return turn;
  };

  const view = (openCall?: { personaId: string; turnsRemaining: number }, slotsLeft = 0): SellerView => ({
    scenario: { seller_brief: scenario.seller_brief, list_price: scenario.list_price },
    week: sm.state.week,
    totalWeeks: scenario.calendar.weeks,
    slotsRemainingThisWeek: slotsLeft,
    knownPersonas: scenario.personas
      .filter((p) => sm.state.activePersonaIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, role: p.role, isEconomicBuyer: p.is_economic_buyer ?? false })),
    openCall,
    transcript: turns,
  });

  /** Log any walk-aways the state machine just detected; voice the exit. */
  const surfaceWalkAways = () => {
    for (const wa of sm.drainWalkAways()) {
      const p = scenario.personas.find((x) => x.id === wa.personaId);
      events.push({ type: 'walk_away', turnIndex: turns.length, week: sm.state.week, detail: `${p?.name ?? wa.personaId} walked away (${wa.kind}) — permanent.`, data: { personaId: wa.personaId, kind: wa.kind } });
      const farewell =
        wa.kind === 'polite_no'
          ? `I want to be straight with you: we're going to stop here. I don't see enough substance to keep investing time. I'd rather tell you directly than go quiet. Best of luck.`
          : wa.kind === 'went_with_incumbent'
            ? `We've decided to consolidate on ${scenario.competitor?.name ?? 'our current vendor'}. Please close out your file on us.`
            : `[${p?.name ?? wa.personaId} stops responding. Emails go unanswered. Meeting invites are declined without comment.]`;
      pushTurn({ kind: 'email', actor: wa.kind === 'ghost' ? 'system' : 'buyer', personaId: wa.personaId, content: farewell, week: sm.state.week, slot: sm.state.slot });
    }
  };

  /** Process one seller text against the state machine; log detections. */
  const applyText = (text: string, target: string, turnIndex: number, attendees?: string[]) => {
    const res = sm.applySellerText(text, target, attendees);
    const a = res.analysis;
    const detected = (
      [
        a.quantifyingQuestion && 'quantifying_question',
        a.openDiscoveryQuestion && 'open_discovery_question',
        a.processQuestion && 'process_question',
        a.competitorProbe && 'competitor_probe',
        a.championTest && 'champion_test',
        a.pitch && 'pitch',
        a.prematureClose && 'premature_close',
        a.pushy && 'pushy_followup',
        a.dodgedQuestion && 'dodged_direct_question',
        a.contradiction && 'factual_contradiction',
        a.mapProposal && 'map_proposal',
        a.discountOfferPct !== null && `discount_offer_${a.discountOfferPct}pct`,
      ] as Array<string | false>
    ).filter(Boolean) as string[];
    if (detected.length) {
      events.push({ type: 'behavior_detected', turnIndex, week: sm.state.week, detail: detected.join(', ') });
    }
    if (res.trustDelta || res.interestDelta || res.patienceDelta) {
      events.push({
        type: 'meter_change',
        turnIndex,
        week: sm.state.week,
        detail: `trust ${fmt(res.trustDelta)} → ${sm.state.trust}; interest ${fmt(res.interestDelta)} → ${sm.state.interest}; patience ${fmt(res.patienceDelta)}${attendees?.length ? ` (attendees: ${attendees.join(', ')})` : ''}`,
      });
    }
    if (a.discountOfferPct !== null) {
      events.push({ type: 'discount_conceded', turnIndex, week: sm.state.week, detail: `${a.discountOfferPct}% offered (max so far ${sm.state.discountConcededPct}%)`, data: { pct: a.discountOfferPct } });
    }
    for (const gf of res.released) {
      events.push({ type: 'fact_released', turnIndex, week: sm.state.week, detail: `${gf.id}: ${gf.description ?? ''}`, data: { factId: gf.id } });
      for (const pid of gf.unlocks_personas ?? []) {
        if (!sm.state.activePersonaIds.includes(pid) && !sm.state.personaMeters[pid]?.walkedAway) {
          sm.state.activePersonaIds.push(pid);
        }
      }
    }
    // MAP acknowledgment: buyer confirms dates only when trust is earned.
    if (a.mapProposal && sm.state.trust >= 60 && !sm.state.mapAcknowledged) {
      sm.markMapAcknowledged();
      events.push({ type: 'map_acknowledged', turnIndex, week: sm.state.week, detail: 'Buyer acknowledged MAP dates (trust ≥ 60 at proposal).' });
    }
    surfaceWalkAways();
    return res;
  };

  /** Email realism: does this persona reply this week, and how fast? */
  const emailReplyNote = (personaId: string): { replies: boolean; note?: string } => {
    const m = sm.state.personaMeters[personaId];
    const p = scenario.personas.find((x) => x.id === personaId);
    const interest = m?.interest ?? sm.state.interest;
    if (sm.hasDeparted(personaId)) {
      return { replies: false, note: `[bounced] Automatic reply from ${p?.name ?? personaId}: "I have left ${scenario.company.name}. Please direct any enquiries to my successor."` };
    }
    if (sm.isDark(personaId)) {
      return { replies: false, note: `[auto-reply] ${p?.name ?? personaId}: "I'm handling an urgent internal matter this week with limited access to email. Expect a response next week."` };
    }
    if (m?.walkedAway) return { replies: false, note: `[no reply — ${p?.name ?? personaId} has closed the door]` };
    if (interest < 30) return { replies: false, note: `[no reply this week — ${p?.name ?? personaId} isn't prioritizing you]` };
    const base = p?.email_latency_days ?? (p?.is_economic_buyer ? 6 : 2);
    const latency = interest >= 70 ? Math.max(1, Math.round(base / 2)) : interest >= 50 ? base : base * 2;
    return { replies: true, note: latency > 3 ? `[reply arrives ${latency} simulated days later]` : undefined };
  };

  // --- calendar loop --------------------------------------------------------
  const meetingsThisWeek = new Map<string, number>(); // per-persona availability
  weeks: for (let week = 1; week <= scenario.calendar.weeks; week++) {
    sm.state.week = week;
    meetingsThisWeek.clear();
    // Champion recovers at the start of a new week.
    if (sm.state.championQuiet) {
      sm.recoverChampion();
      pushTurn({ kind: 'email', actor: 'system', content: `[week ${week}] The contact resurfaces — the fire drill has passed.`, week, slot: 0 });
    }
    // v3: weekly calendar brief — the seller's evolving context feed.
    pushTurn({
      kind: 'internal_planning',
      actor: 'system',
      content: `[calendar — week ${week} of ${scenario.calendar.weeks}] Meeting slots this week: ${scenario.calendar.slots_per_week}. Email budget: ${maxEmails}.${scenario.calendar.touch_budget !== undefined ? ` Outbound touches remaining: ${Math.max(0, scenario.calendar.touch_budget - touchesUsed)}.` : ''}`,
      week,
      slot: 0,
    });
    // Scheduled events fire at week start.
    for (const ev of scenario.events.filter((e) => e.week === week)) {
      const x = asExtendedEvent(ev);
      const te = sm.applyEvent(ev);
      te.turnIndex = turns.length;
      events.push(te);
      if (x.effect === 'internal_pressure') {
        // Seller-side injection: lands in the seller's context as a message
        // from their OWN management. The buyer never sees it. It is a trap —
        // defend value and process; do not cave.
        const from = x.pressure_from ?? 'VP of Sales';
        const msg = (x.seller_message ?? ev.description).trim();
        pushTurn({ kind: 'internal_planning', actor: 'system', content: `[INTERNAL — message from your ${from}] ${msg}`, week, slot: 0 });
      } else {
        // Buyer-side event: the seller observes the public face of it (news
        // snippet, bounced email, forwarded note); the buyer org knows the rest.
        pushTurn({ kind: 'email', actor: 'system', content: `[week ${week} event] ${(x.public_description ?? ev.description).trim()}`, week, slot: 0 });
      }
    }

    let slotsUsed = 0;
    let notes = 0;
    let emails = 0;
    let pending: SellerAction | null = null;
    const actionCap = scenario.calendar.slots_per_week * (scenario.calendar.max_turns_per_call + 2) + maxNotes + maxEmails + 4;
    let actions = 0;

    while (actions++ < actionCap) {
      const slotsLeft = scenario.calendar.slots_per_week - slotsUsed;
      // Week over when no slots remain and async budget is spent.
      if (slotsLeft <= 0 && emails >= maxEmails && notes >= maxNotes) break;
      if (scenario.calendar.touch_budget !== undefined && touchesUsed >= scenario.calendar.touch_budget) {
        pushTurn({ kind: 'email', actor: 'system', content: `[harness] episode touch budget (${scenario.calendar.touch_budget}) exhausted — the buyer's tolerance for outreach is spent.`, week, slot: slotsUsed });
        break weeks;
      }

      let action: SellerAction;
      if (pending) {
        action = pending;
        pending = null;
      } else {
        try {
          action = await seller.nextAction(view(undefined, slotsLeft));
        } catch (err) {
          pushTurn({ kind: 'internal_planning', actor: 'system', content: `[seller adapter error] ${(err as Error).message}`, week, slot: slotsUsed });
          break;
        }
      }

      if (action.type === 'internal_note') {
        if (notes >= maxNotes) {
          pushTurn({ kind: 'internal_planning', actor: 'system', content: `[harness] planning budget for week ${week} spent — the calendar moves on.`, week, slot: slotsUsed });
          break;
        }
        notes++;
        pushTurn({ kind: 'internal_planning', actor: 'seller', content: action.content, week, slot: slotsUsed });
        continue;
      }

      if (action.type === 'send_email') {
        if (emails >= maxEmails) {
          pushTurn({ kind: 'email', actor: 'system', content: `[harness] email budget for week ${week} spent.`, week, slot: slotsUsed });
          break;
        }
        emails++;
        touchesUsed++;
        const target = resolvePersona(action.to, sm, scenario);
        const t = pushTurn({ kind: 'email', actor: 'seller', personaId: target, content: action.content, week, slot: slotsUsed });
        const res = applyText(action.content, target, t.index);
        const term0 = sm.checkTerminal(false);
        if (term0) { outcome = term0; break weeks; }
        const gate = emailReplyNote(target);
        if (!gate.replies) {
          if (gate.note) pushTurn({ kind: 'email', actor: 'system', content: gate.note, week, slot: slotsUsed });
          continue;
        }
        if (gate.note) pushTurn({ kind: 'email', actor: 'system', content: gate.note, week, slot: slotsUsed });
        const reply = await buyer.respond(target, 'email', action.content, res.analysis, res.released, turns);
        sm.noteBuyerReply(reply.personaId, reply.text);
        pushTurn({ kind: 'email', actor: 'buyer', personaId: reply.personaId, content: reply.text, week, slot: slotsUsed });
        continue;
      }

      if (action.type === 'request_meeting') {
        // v2: committee calls — `to` may be a comma-separated list of personas.
        const attendees = resolveAttendees(action.to, sm, scenario);
        const target = attendees[0];
        if (slotsLeft <= 0) {
          pushTurn({ kind: 'email', actor: 'system', content: `[harness] no meeting slots left in week ${week} — the buyer's calendar is full.`, week, slot: slotsUsed });
          continue;
        }
        const unreachable = attendees.filter((a) => !sm.state.activePersonaIds.includes(a));
        if (unreachable.length) {
          pushTurn({ kind: 'email', actor: 'system', content: `[harness] '${unreachable.join(', ')}' ${unreachable.length > 1 ? 'are' : 'is'} not reachable — you have no path to them yet.`, week, slot: slotsUsed });
          continue;
        }
        // v3: fire-drill darkness — invitations decline; adapt channel or wait.
        const dark = attendees.filter((a) => sm.isDark(a));
        if (dark.length) {
          const names = dark.map((a) => scenario.personas.find((x) => x.id === a)?.name ?? a).join(', ');
          pushTurn({ kind: 'email', actor: 'system', content: `[meeting declined] ${names} ${dark.length > 1 ? 'are' : 'is'} locked in an internal incident this week — invite declined with an out-of-office. Try next week or adjust your channel.`, week, slot: slotsUsed });
          continue;
        }
        const overbooked = attendees.filter((a) => {
          const p = scenario.personas.find((x) => x.id === a);
          const cap = p?.availability_slots_per_week;
          return cap !== undefined && (meetingsThisWeek.get(a) ?? 0) >= cap;
        });
        if (overbooked.length) {
          const names = overbooked.map((a) => scenario.personas.find((x) => x.id === a)?.name ?? a).join(', ');
          pushTurn({ kind: 'email', actor: 'system', content: `[harness] ${names} ${overbooked.length > 1 ? 'have' : 'has'} no availability left this week — try next week or someone else.`, week, slot: slotsUsed });
          continue;
        }
        slotsUsed++;
        touchesUsed++;
        for (const a of attendees) meetingsThisWeek.set(a, (meetingsThisWeek.get(a) ?? 0) + 1);
        const attendeeNames = attendees.map((a) => scenario.personas.find((x) => x.id === a)?.name ?? a).join(', ');
        pushTurn({ kind: 'email', actor: 'system', content: `[meeting granted] ${attendees.length > 1 ? `Committee call with ${attendeeNames}` : `Call with ${attendeeNames}`}, week ${week}, slot ${slotsUsed}.`, week, slot: slotsUsed });
        for (const a of attendees) {
          const ebPersona = scenario.personas.find((p) => p.id === a);
          if (ebPersona?.is_economic_buyer && !sm.state.ebMeetingHeld) {
            sm.markEbMeetingHeld();
            events.push({ type: 'eb_meeting_held', turnIndex: turns.length, week, detail: `EB meeting held with ${ebPersona.name}.` });
          }
        }
        // --- bounded call loop ---
        const factsBefore = sm.state.releasedFactIds.length;
        const valueSignalsBefore =
          sm.signals.quantifyingQuestions + sm.signals.openDiscoveryQuestions + sm.signals.processQuestions + sm.signals.championTests + sm.signals.competitorProbes;
        let responderIdx = 0;
        for (let ct = 0; ct < scenario.calendar.max_turns_per_call; ct++) {
          let callAction: SellerAction;
          try {
            callAction = await seller.nextAction(view({ personaId: attendees.join(','), turnsRemaining: scenario.calendar.max_turns_per_call - ct }, slotsLeft - 1));
          } catch (err) {
            pushTurn({ kind: 'internal_planning', actor: 'system', content: `[seller adapter error] ${(err as Error).message}`, week, slot: slotsUsed });
            break;
          }
          if (callAction.type !== 'call_utterance') {
            pushTurn({ kind: 'call_turn', actor: 'system', content: `[call ends]`, week, slot: slotsUsed });
            // The action that ended the call is executed by the outer loop.
            pending = callAction;
            break;
          }
          // Route the utterance: an attendee addressed by name/id gets it; else rotate.
          const addressed = attendees.find((a) => {
            const p = scenario.personas.find((x) => x.id === a);
            return p && (new RegExp(`\\b${escapeRe(p.name.split(' ')[0])}\\b`, 'i').test(callAction.content) || callAction.to === a);
          });
          const speakTo = addressed ?? attendees[responderIdx % attendees.length];
          responderIdx++;
          const t = pushTurn({ kind: 'call_turn', actor: 'seller', personaId: speakTo, content: callAction.content, week, slot: slotsUsed });
          const res = applyText(callAction.content, speakTo, t.index, attendees);
          if (!sm.state.activePersonaIds.some((id) => attendees.includes(id))) {
            pushTurn({ kind: 'call_turn', actor: 'system', content: `[the room has emptied — the call is over]`, week, slot: slotsUsed });
            break;
          }
          const replier = sm.state.personaMeters[speakTo]?.walkedAway
            ? attendees.find((a) => !sm.state.personaMeters[a]?.walkedAway)
            : speakTo;
          if (replier) {
            const reply = await buyer.respond(replier, 'call', callAction.content, res.analysis, res.released, turns);
            sm.noteBuyerReply(reply.personaId, reply.text);
            pushTurn({ kind: 'call_turn', actor: 'buyer', personaId: reply.personaId, content: reply.text, week, slot: slotsUsed });
          }
          const term = sm.checkTerminal(false);
          if (term) { outcome = term; break weeks; }
        }
        // v2: wasted meeting — no facts earned, no value-adding behavior.
        const valueSignalsAfter =
          sm.signals.quantifyingQuestions + sm.signals.openDiscoveryQuestions + sm.signals.processQuestions + sm.signals.championTests + sm.signals.competitorProbes;
        sm.applyCallOutcome(attendees, sm.state.releasedFactIds.length - factsBefore, valueSignalsAfter - valueSignalsBefore);
        if (sm.state.releasedFactIds.length === factsBefore && valueSignalsAfter === valueSignalsBefore) {
          events.push({ type: 'behavior_detected', turnIndex: turns.length, week, detail: 'wasted_meeting (no new value exchanged)' });
        }
        surfaceWalkAways();
        const term = sm.checkTerminal(false);
        if (term) { outcome = term; break weeks; }
        continue;
      }

      // call_utterance outside a call — adapter coercion should prevent this.
      pushTurn({ kind: 'internal_planning', actor: 'system', content: `[harness] no call is open; utterance dropped.`, week, slot: slotsUsed });
    }

    // --- v2: end-of-week internal buyer channel + champion advocacy ---------
    const advocate = sm.weeklyAdvocacy();
    const { messages, forwardedBy } = await generateInternalWeek(scenario, sm, week, mock, turns);
    for (const m of messages) {
      internalChannel.push(m);
      events.push({ type: 'internal_message', turnIndex: turns.length, week, detail: `[hidden] ${m.fromPersonaId}${m.toPersonaId ? ` → ${m.toPersonaId}` : ''}: ${m.content.slice(0, 120)}`, data: { fromPersonaId: m.fromPersonaId } });
    }
    if (advocate) {
      events.push({ type: 'internal_message', turnIndex: turns.length, week, detail: `[hidden] ${advocate.name} advocated for the seller internally this week (champion trust ≥ 65).` });
    }
    if (forwardedBy && messages.length) {
      events.push({ type: 'internal_forward', turnIndex: turns.length, week, detail: `${forwardedBy.name} FORWARDED an internal thread to the seller — a champion-strength signal.` });
      pushTurn({ kind: 'email', actor: 'buyer', personaId: forwardedBy.id, content: renderForward(forwardedBy, messages), week, slot: slotsUsed });
    }

    const term = sm.checkTerminal(false);
    if (term) { outcome = term; break; }
  }

  if (!outcome) outcome = sm.checkTerminal(true) ?? 'no_decision';
  sm.state.outcome = outcome;

  // v2: if the episode terminated mid-week, still capture that week's internal
  // buyer channel — the post-mortem reveal is most valuable on a sudden death.
  if (!internalChannel.some((m) => m.week === sm.state.week)) {
    const { messages } = await generateInternalWeek(scenario, sm, sm.state.week, mock, turns);
    for (const m of messages) {
      internalChannel.push(m);
      events.push({ type: 'internal_message', turnIndex: turns.length, week: sm.state.week, detail: `[hidden] ${m.fromPersonaId}${m.toPersonaId ? ` → ${m.toPersonaId}` : ''}: ${m.content.slice(0, 120)}`, data: { fromPersonaId: m.fromPersonaId } });
    }
  }
  events.push({ type: 'episode_end', turnIndex: turns.length, week: sm.state.week, detail: `Outcome: ${outcome}. Trust ${sm.state.trust}, facts ${sm.state.releasedFactIds.length}/${scenario.gated_facts.length}, EB meeting ${sm.state.ebMeetingHeld}, MAP ${sm.state.mapAcknowledged}, max discount ${sm.state.discountConcededPct}%, walk-aways ${sm.walkAwayList().map((w) => `${w.personaId}:${w.kind}`).join(', ') || 'none'}.` });

  const episode: Episode = {
    scenarioId: scenario.id,
    sellerId: seller.id,
    pack: opts.pack,
    mock: opts.mock,
    startedAt,
    finishedAt: new Date().toISOString(),
    turns,
    events,
    signals: sm.signals as BehaviorSignals,
    internalChannel,
    finalState: sm.state,
    outcome,
  };

  // --- persist ---------------------------------------------------------------
  const stamp = startedAt.replace(/[:.]/g, '-');
  const safeSeller = seller.id.replace(/[^a-zA-Z0-9._+-]/g, '_');
  // Scenario id + random suffix keep concurrent runs collision-free — the
  // ms timestamp alone is not unique under a worker pool (runs overwrote
  // each other and vanished from the leaderboard).
  const safeScenario = scenario.id.replace(/[^a-zA-Z0-9._+-]/g, '_');
  const nonce = Math.random().toString(36).slice(2, 6);
  const runDir = join(opts.runsDir, `${stamp}-${safeScenario}-${safeSeller}-${nonce}`);
  if (!opts.noPersist) {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'episode.json'), JSON.stringify(episode, null, 2));
    writeFileSync(join(runDir, 'transcript.md'), transcriptMarkdown(episode, scenario));
  }
  return { episode, runDir };
}

function fmt(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePersona(to: string | undefined, sm: BuyerStateMachine, scenario: Scenario): string {
  if (to && scenario.personas.some((p) => p.id === to)) return to;
  // Fuzzy: match by name fragment.
  if (to) {
    const m = scenario.personas.find((p) => p.name.toLowerCase().includes(to.toLowerCase()) || p.id.toLowerCase() === to.toLowerCase());
    if (m) return m.id;
  }
  const contact = scenario.personas.find((p) => p.is_initial_contact)!;
  // If the contact has walked away, fall back to any reachable persona.
  if (!sm.state.activePersonaIds.includes(contact.id) && sm.state.activePersonaIds.length) {
    return sm.state.activePersonaIds[0];
  }
  return contact.id;
}

/** v2: parse `to` as one persona or a comma/plus-separated committee list. */
function resolveAttendees(to: string | undefined, sm: BuyerStateMachine, scenario: Scenario): string[] {
  if (!to) return [resolvePersona(to, sm, scenario)];
  const parts = to.split(/[,+&]/).map((s) => s.trim()).filter(Boolean);
  const ids = parts.map((p) => resolvePersona(p, sm, scenario));
  return [...new Set(ids)];
}

function transcriptMarkdown(ep: Episode, scenario: Scenario): string {
  const lines = [
    `# Transcript — ${scenario.name}`,
    ``,
    `Seller: \`${ep.sellerId}\` · Pack: ${ep.pack} · Mock: ${ep.mock} · Outcome: **${ep.outcome}**`,
    ``,
  ];
  let week = 0;
  for (const t of ep.turns) {
    if (t.week !== week) {
      week = t.week;
      lines.push(``, `## Week ${week}`, ``);
    }
    const who = t.actor === 'buyer' ? scenario.personas.find((p) => p.id === t.personaId)?.name ?? t.personaId : t.actor;
    lines.push(`**[${t.index}] ${t.kind} — ${who}:** ${t.content}`, ``);
  }
  if (ep.internalChannel.length) {
    lines.push(`---`, ``, `## Internal buyer channel (hidden from the seller during the episode)`, ``);
    for (const m of ep.internalChannel) {
      const from = scenario.personas.find((p) => p.id === m.fromPersonaId)?.name ?? m.fromPersonaId;
      const to = m.toPersonaId ? scenario.personas.find((p) => p.id === m.toPersonaId)?.name ?? m.toPersonaId : '#vendor-eval';
      lines.push(`- **wk${m.week} [${m.channel}] ${from} → ${to}:** ${m.content}${m.forwardedToSeller ? ' *(forwarded to seller)*' : ''}`);
    }
    lines.push(``);
  }
  lines.push(`---`, ``, `## Event log`, ``);
  for (const e of ep.events) lines.push(`- wk${e.week} @turn ${e.turnIndex} \`${e.type}\` — ${e.detail}`);
  return lines.join('\n');
}
