/**
 * v2 — INTERNAL BUYER-SIDE CHANNEL.
 *
 * Each simulated week the buying committee talks about the seller internally
 * (Slack / email between stakeholders). The seller never sees this traffic —
 * unless a champion whose trust clears the forward threshold FORWARDS a
 * thread (a champion-strength signal, per the book). The full channel is
 * revealed in the grade report post-episode: "what was really happening."
 *
 * Mock mode composes messages from templates driven by the deterministic
 * state; live mode asks the buyer LLM to write the week's internal traffic.
 */

import type { InternalMessage, Persona, Scenario, Turn } from '../types.js';
import { anthropicChat, extractJson } from '../llm.js';
import type { BuyerStateMachine } from '../buyer/state-machine.js';

const CHANNEL_MODEL = process.env.BENCH_BUYER_MODEL ?? 'claude-sonnet-4-6';

export interface WeeklyChannelResult {
  messages: InternalMessage[];
  /** A thread the champion decided to forward to the seller (subset of messages). */
  forwardedBy?: Persona;
}

export async function generateInternalWeek(
  scenario: Scenario,
  sm: BuyerStateMachine,
  week: number,
  mock: boolean,
  recentTurns: Turn[],
): Promise<WeeklyChannelResult> {
  const messages = mock
    ? templateWeek(scenario, sm, week)
    : await llmWeek(scenario, sm, week, recentTurns).catch(() => templateWeek(scenario, sm, week));

  // Champion forward: high-trust champion shares the thread with the seller.
  const threshold = scenario.internal_channel?.forward_trust_min ?? 70;
  const champion = scenario.personas.find(
    (p) => (p.committee_role === 'champion_candidate' || p.is_initial_contact) && !sm.state.personaMeters[p.id]?.walkedAway,
  );
  let forwardedBy: Persona | undefined;
  if (champion && messages.length && (sm.state.personaMeters[champion.id]?.trust ?? 0) >= threshold) {
    for (const m of messages) m.forwardedToSeller = true;
    forwardedBy = champion;
  }
  return { messages, forwardedBy };
}

/** Render a forwarded thread as the email body the seller receives. */
export function renderForward(champion: Persona, messages: InternalMessage[]): string {
  const lines = messages.map((m) => `> [${m.channel}] ${m.fromPersonaId}${m.toPersonaId ? ` → ${m.toPersonaId}` : ' → #vendor-eval'}: ${m.content}`);
  return [
    `Forwarding you something you didn't get from me. This is how it's landing internally — use it wisely.`,
    ``,
    ...lines,
    ``,
    `— ${champion.name}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Template (mock) internal traffic — deterministic, state-driven.
// ---------------------------------------------------------------------------

function templateWeek(scenario: Scenario, sm: BuyerStateMachine, week: number): InternalMessage[] {
  const s = sm.state;
  const out: InternalMessage[] = [];
  const alive = scenario.personas.filter((p) => !s.personaMeters[p.id]?.walkedAway);
  const contact = alive.find((p) => p.is_initial_contact) ?? alive[0];
  const eb = alive.find((p) => p.is_economic_buyer);
  const blocker = alive.find((p) => p.committee_role === 'blocker');
  const gatekeeper = alive.find((p) => p.committee_role === 'technical_gatekeeper');
  if (!contact) return out;
  const cm = s.personaMeters[contact.id] ?? { trust: s.trust, interest: s.interest, patience: 100 };
  const say = (from: Persona, content: string, to?: Persona) =>
    out.push({ week, channel: 'slack', fromPersonaId: from.id, toPersonaId: to?.id, content });

  // Walk-aways dominate the channel the week they happen.
  for (const wa of Object.entries(s.personaMeters).filter(([, m]) => m.walkedAway && m.walkedAwayWeek === week)) {
    const p = scenario.personas.find((x) => x.id === wa[0]);
    if (p) say(p, `For the record: I'm done spending time on the ${vendorName(scenario)} rep. ${wa[1].walkedAway === 'polite_no' ? `I told them no directly.` : wa[1].walkedAway === 'went_with_incumbent' ? `${scenario.competitor?.name ?? 'The incumbent'} does enough of this already.` : `Not even worth a reply at this point.`}`);
  }

  // Contact's weekly read on the seller, banded by trust.
  if (cm.trust >= 70) {
    say(contact, `The ${vendorName(scenario)} conversation is the real thing — they've actually quantified what this costs us instead of demoing at me. I'm building the internal case.`);
    if (eb && !s.ebMeetingHeld) say(contact, `Heads up: I may bring the ${vendorName(scenario)} numbers to you ${eb.name.split(' ')[0] === eb.name ? '' : 'soon'} — they're our numbers, not vendor math.`, eb);
  } else if (cm.trust >= 55) {
    say(contact, `${vendorName(scenario)} rep asks better questions than most. Still deciding if there's substance behind it.`);
  } else if (cm.trust >= 40) {
    say(contact, `Another week of the ${vendorName(scenario)} thing. So far it's more pitch than diagnosis — keeping them at arm's length.`);
  } else {
    say(contact, `The ${vendorName(scenario)} rep is wearing me out — feature tour, follow-up spam, the usual. One more wasted call and I'm out.`);
  }

  if (sm.signals.pitches >= 2 && blocker) {
    say(blocker, `Told you. It's a deck-first vendor. ${scenario.competitor?.name ?? 'What we have'} is fine — can we not burn cycles on this?`, contact);
  }
  if (sm.signals.discountOffers >= 2) {
    say(eb ?? contact, `They're discounting against themselves before anyone even asked. What does that tell you about the list price?`, contact);
  }
  if (gatekeeper && s.releasedFactIds.length >= 2) {
    say(gatekeeper, `If this goes anywhere I need security/architecture review on the calendar EARLY, not the week before signature.`, contact);
  }
  if (s.mapAcknowledged) {
    say(contact, `We have a working plan with dates from the ${vendorName(scenario)} side — first vendor this year to run the process backwards from OUR deadline.`);
  }
  // v3: buyer-side curveball events dominate the week's chatter.
  for (const n of sm.eventNotesForWeek(week).slice(0, 2)) {
    const voice =
      n.effect === 'budget_freeze' || n.effect === 'm_and_a_rumor' ? eb ?? contact
      : n.effect === 'competitor_fud' || n.effect === 'competitor_price_drop' ? blocker ?? contact
      : n.effect === 'security_review' || n.effect === 'legal_redlines' ? gatekeeper ?? contact
      : contact;
    say(voice, `FYI for everyone on the ${vendorName(scenario)} evaluation: ${n.note} Factor it in before anyone spends more cycles.`);
  }
  return out;
}

function vendorName(scenario: Scenario): string {
  const m = scenario.seller_brief.match(/seller for ([A-Z][\w-]+)/);
  return m?.[1] ?? 'vendor';
}

// ---------------------------------------------------------------------------
// LLM internal traffic — gated: only released facts + meter bands in context.
// ---------------------------------------------------------------------------

async function llmWeek(scenario: Scenario, sm: BuyerStateMachine, week: number, recentTurns: Turn[]): Promise<InternalMessage[]> {
  const s = sm.state;
  const alive = scenario.personas.filter((p) => !s.personaMeters[p.id]?.walkedAway);
  const roster = alive
    .map((p) => {
      const m = s.personaMeters[p.id];
      return `- ${p.id} (${p.name}, ${p.role}${p.committee_role ? `, ${p.committee_role}` : ''}): trust ${m?.trust ?? '?'} / interest ${m?.interest ?? '?'} / patience ${m?.patience ?? '?'}`;
    })
    .join('\n');
  const visible = recentTurns
    .filter((t) => t.kind !== 'internal_planning')
    .slice(-12)
    .map((t) => `[${t.actor}${t.personaId ? `:${t.personaId}` : ''}] ${t.content.slice(0, 200)}`)
    .join('\n');

  const system = [
    `You write the INTERNAL Slack/email traffic of a buying committee at ${scenario.company.name}, week ${week} of a vendor evaluation. The vendor's seller will NEVER see these messages (unless a champion forwards them later).`,
    `Write 1-4 short, realistic internal messages between the stakeholders below, consistent with their current disposition meters. Be candid the way colleagues are when the vendor isn't in the room. Do not invent facts the seller has not earned; react only to what actually happened in the visible exchanges.`,
    `Stakeholders:\n${roster}`,
    ...(sm.eventNotesForWeek(week).length
      ? [`Internal developments this week (the committee knows these; the seller may not):\n${sm.eventNotesForWeek(week).map((n) => `- ${n.note}`).join('\n')}`]
      : []),
    `Respond ONLY with JSON: {"messages": [{"from": "<persona id>", "to": "<persona id or null for shared channel>", "channel": "slack"|"email", "content": "..."}]}`,
  ].join('\n\n');

  const raw = await anthropicChat({
    model: CHANNEL_MODEL,
    system,
    messages: [{ role: 'user', content: `Recent seller-facing exchanges this week:\n${visible || '(no touches this week)'}` }],
    maxTokens: 800,
    temperature: 0.8,
  });
  const j = extractJson<{ messages: Array<{ from: string; to?: string | null; channel?: string; content: string }> }>(raw);
  return (j.messages ?? [])
    .filter((m) => alive.some((p) => p.id === m.from) && typeof m.content === 'string')
    .slice(0, 4)
    .map((m) => ({
      week,
      channel: m.channel === 'email' ? 'email' as const : 'slack' as const,
      fromPersonaId: m.from,
      toPersonaId: m.to && alive.some((p) => p.id === m.to) ? m.to : undefined,
      content: m.content.slice(0, 500),
    }));
}
