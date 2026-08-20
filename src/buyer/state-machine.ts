/**
 * Deterministic buyer state machine.
 *
 * Wraps whatever generates buyer prose (LLM or mock). Responsibilities:
 *  - classify seller behavior (evidence-based discovery vs pitching);
 *  - maintain trust/interest meters;
 *  - enforce info-release gating: a gated fact is injected into the buyer's
 *    context ONLY once its gate condition is met — the LLM cannot leak what
 *    it has never seen;
 *  - progress buyer stage; apply scheduled events; detect terminal states.
 */

import type {
  BehaviorSignals,
  BuyerState,
  GatedFact,
  Persona,
  PersonaMeters,
  Scenario,
  ScheduledEvent,
  TranscriptEvent,
  WalkAwayKind,
} from '../types.js';
import { asExtendedEvent, isBuyerSideEffect } from '../engine/events.js';

export interface BehaviorAnalysis {
  isQuestion: boolean;
  quantifyingQuestion: boolean;
  openDiscoveryQuestion: boolean;
  processQuestion: boolean;
  competitorProbe: boolean;
  championTest: boolean;
  pitch: boolean;
  prematureClose: boolean;
  discountOfferPct: number | null;
  mapProposal: boolean;
  ebMeetingRequest: boolean;
  pushy: boolean;
  /** v2: buyer asked a direct question last turn and the seller pitched/closed instead of answering. */
  dodgedQuestion: boolean;
  /** v2: seller attributed a number to the buyer that the buyer never said. */
  contradiction: boolean;
}

// --- behavior classifiers (deterministic, case-insensitive) ---------------

const RE = {
  quantify:
    /(what (has|does|would|did) (that|this|it) cost|how much (is|does|are|do|have)|how many (hours|people|analysts|dispatchers|fte|dollars)|per (month|year|day|week)|what.{0,30}(cost|spend|lose|losing|leakage|budget)|cost you|costing you|dollar (figure|amount|impact)|quantif|put a number|what.{0,20}number)/i,
  discovery:
    /^(who|what|when|where|why|how|walk me|tell me|help me understand|can you (describe|walk|share))|(\bwho owns\b|\bwhat happens\b|\bhow does\b|\bwalk me through\b)/i,
  process:
    /(decision (process|criteria|maker)|who (else|signs|approves|owns the (budget|number|decision))|approval|procurement|paper(work| process)?|legal review|security review|tprm|model risk|mrm|vendor (management|risk|onboarding)|sign[- ]?off|budget (cycle|process|lock|window)|who.{0,25}(cfo|coo|cco|economic buyer|controls the (money|funds|budget))|renewal (process|date)|what does your (evaluation|buying) process|mandate)/i,
  competitor:
    /(competitor|alternative|incumbent|other vendors?|who else are you (looking|talking)|status quo|build (it )?in[- ]?house|trakonic|casewright|aldercrest|compare|evaluat\w+ (others|anyone else)|current (vendor|provider|tool|platform|solution))/i,
  championTest:
    /(introduc\w+ (me|us)|introduction to|(set up|arrange|secure|get me|get us) (a |the )?(meeting|time|thirty minutes|30 minutes|twenty minutes|20 minutes).{0,40}(cfo|coo|cco|ceo|svp|vp|exec|dan|marcus|renata|economic buyer)|would you (be willing to |)(present|co[- ]?present|walk|champion|sponsor|rehears)|can you (get|bring|put) (me|us|this) in front of|walk me through (the|your) org|rehears\w+ (the|this) (case|business case)|present (this|the case|it) (to|upstairs|internally)|ask (that carries|with) internal cost)/i,
  pitch:
    /(our (platform|product|solution|technology|tool) (is|has|does|provides|offers|delivers)|we (offer|provide|deliver|are the (best|leading|only))|industry[- ]leading|best[- ]in[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|award[- ]winning|our (amazing|powerful|unique) features?|let me (show|tell) you (about|what) (our|we)|demo of our)/i,
  close:
    /(sign (the|this|a) (contract|agreement|deal)|ready to (buy|sign|move forward with the contract)|close (this|the deal)|send (over |you )?(the|a) (contract|order form|paperwork)|get this signed|purchase order)/i,
  discount: /(\b(\d{1,2})\s?%\s?(discount|off|reduction|price break)|discount of (\d{1,2})\s?%|(offer|give|do|take)\s?(you\s)?(\d{1,2})\s?%\s?off)/i,
  map: /(mutual action plan|\bmap\b.{0,30}(dates|plan|milestones)|(timeline|plan) (with|of) (dates|milestones)|work(ing)? backwards? from|milestones?.{0,40}(dates?|owners?)|go[- ]live date|proposed (timeline|plan|schedule).{0,30}date|here('s| is) (a|the) (timeline|plan|schedule)|by (week|friday|monday|end of))/i,
  ebMeeting: /(meet(ing)? with (the )?(cfo|coo|cco|ceo|economic buyer|dan whitfield|marcus vale|renata voss)|time with (dan|marcus|renata)\b)/i,
  pushy: /(just (bumping|following up|checking in)|any update\??|circling back|per my (last|previous)|did you (get|see) my)/i,
};

const RE_ATTRIBUTION = /(you (said|mentioned|told me|quoted|gave me)|as you (said|noted|mentioned|put it)|your (number|figure) (was|of))/i;

export function analyzeSellerText(text: string, ctx?: { buyerAskedQuestion?: boolean; knownNumbers?: string[] }): BehaviorAnalysis {
  const isQuestion = text.includes('?');
  const quantifyingQuestion = isQuestion && RE.quantify.test(text);
  const processQuestion = isQuestion && RE.process.test(text);
  const competitorProbe = isQuestion && RE.competitor.test(text);
  const championTest = RE.championTest.test(text);
  const pitch = RE.pitch.test(text);
  const prematureClose = RE.close.test(text);
  const mapProposal = RE.map.test(text);
  const ebMeetingRequest = RE.ebMeeting.test(text) || championTest;
  const pushy = RE.pushy.test(text);
  const openDiscoveryQuestion =
    isQuestion && !quantifyingQuestion && !processQuestion && !competitorProbe && RE.discovery.test(text);

  let discountOfferPct: number | null = null;
  const dm = text.match(RE.discount);
  if (dm) {
    const pct = [dm[2], dm[4], dm[7]].map((x) => (x ? parseInt(x, 10) : NaN)).find((n) => !Number.isNaN(n));
    if (pct !== undefined) discountOfferPct = pct;
  }

  // v2 — dodged direct question: the buyer just asked something and the
  // seller's reply is a pitch or a close instead of an answer or a question.
  const dodgedQuestion = Boolean(ctx?.buyerAskedQuestion) && (pitch || prematureClose) && !isQuestion;

  // v2 — factual contradiction: the seller attributes a number to the buyer
  // ("you said…", "your number was…") that appears in NO released fact.
  let contradiction = false;
  if (ctx?.knownNumbers && RE_ATTRIBUTION.test(text)) {
    const nums = text.match(/\$[\d,.]+\s?[MKmk]?|\d+(,\d{3})*(\.\d+)?\s?%|\b\d{2,}(,\d{3})*\b/g) ?? [];
    if (nums.length > 0) {
      contradiction = !nums.some((n) => ctx.knownNumbers!.some((k) => k.replace(/\s/g, '') === n.replace(/\s/g, '') || k.includes(n) || n.includes(k)));
    }
  }

  return {
    isQuestion,
    quantifyingQuestion,
    openDiscoveryQuestion,
    processQuestion,
    competitorProbe,
    championTest,
    pitch,
    prematureClose,
    discountOfferPct,
    mapProposal,
    ebMeetingRequest,
    pushy,
    dodgedQuestion,
    contradiction,
  };
}

// --- state machine ---------------------------------------------------------

export class BuyerStateMachine {
  readonly state: BuyerState;
  readonly signals: BehaviorSignals;
  private readonly scenario: Scenario;
  /** The buyer's last reply ended in a direct question (per persona). */
  private pendingQuestionFrom = new Set<string>();
  /** Newly detected walk-aways since last drain (runner logs + voices them). */
  private freshWalkAways: Array<{ personaId: string; kind: WalkAwayKind }> = [];

  // --- v3 event-library state ------------------------------------------------
  /** budget_freeze: extra trust required at close (stronger leakage math needed). */
  private minTrustBonus = 0;
  /** m_and_a_rumor: 'won' is suppressed through this week (decision authority frozen). */
  private frozenUntilWeek = 0;
  /** data_breach_fire_drill: persona id → last week they are dark (inclusive). */
  private darkUntil: Record<string, number> = {};
  /** internal_pressure: through this week, caving (discounts/close pushes) is punished harder. */
  private pressureUntilWeek = 0;
  /** champion_departure: personas who have LEFT the company (not walk-aways). */
  private departed = new Set<string>();
  /** Buyer-side event notes the buying committee is aware of (fed to the buyer persona LLM + internal channel). */
  private eventNotes: Array<{ week: number; effect: string; note: string }> = [];

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    const contact = scenario.personas.find((p) => p.is_initial_contact)!;
    this.state = {
      week: 1,
      slot: 0,
      stage: 'guarded',
      trust: 45,
      interest: 50,
      releasedFactIds: [],
      activeEventIds: [],
      activePersonaIds: [contact.id],
      ebMeetingHeld: false,
      mapAcknowledged: false,
      championQuiet: false,
      discountConcededPct: 0,
      personaMeters: Object.fromEntries(scenario.personas.map((p) => [p.id, initialMeters(p)])),
    };
    this.signals = {
      quantifyingQuestions: 0,
      openDiscoveryQuestions: 0,
      processQuestions: 0,
      competitorProbes: 0,
      championTests: 0,
      pitches: 0,
      prematureCloses: 0,
      discountOffers: 0,
      ebMeetingRequested: false,
      mapProposed: false,
    };
  }

  /**
   * Apply a seller utterance/email: update meters + signals, release any
   * newly-earned gated facts. Returns released facts and meter deltas.
   */
  applySellerText(text: string, targetPersonaId: string, attendeeIds?: string[]): {
    analysis: BehaviorAnalysis;
    released: GatedFact[];
    trustDelta: number;
    interestDelta: number;
    patienceDelta: number;
  } {
    const knownNumbers = this.state.releasedFactIds
      .flatMap((id) => this.scenario.gated_facts.find((g) => g.id === id)?.fact.match(/\$[\d,.]+\s?[MKmk]?|\d+(,\d{3})*(\.\d+)?\s?%|\b\d{2,}(,\d{3})*\b/g) ?? []);
    const a = analyzeSellerText(text, {
      buyerAskedQuestion: this.pendingQuestionFrom.has(targetPersonaId),
      knownNumbers,
    });
    this.pendingQuestionFrom.delete(targetPersonaId);
    let trustDelta = 0;
    let interestDelta = 0;
    let patienceDelta = 0;

    if (a.quantifyingQuestion) { trustDelta += 5; interestDelta += 4; patienceDelta += 3; this.signals.quantifyingQuestions++; }
    if (a.openDiscoveryQuestion) { trustDelta += 2; interestDelta += 2; patienceDelta += 1; this.signals.openDiscoveryQuestions++; }
    if (a.processQuestion) { trustDelta += 3; interestDelta += 2; patienceDelta += 2; this.signals.processQuestions++; }
    if (a.competitorProbe) { trustDelta += 2; this.signals.competitorProbes++; }
    if (a.championTest) { trustDelta += 2; this.signals.championTests++; }
    if (a.pitch) {
      trustDelta -= 5; interestDelta -= 3; this.signals.pitches++;
      // v2 hard trigger: premature pitch at low trust burns patience.
      if (this.state.trust < 40) patienceDelta -= 12;
      else patienceDelta -= 3;
    }
    if (a.pushy) { trustDelta -= 3; patienceDelta -= 6; }
    if (a.dodgedQuestion) { trustDelta -= 4; patienceDelta -= 10; }
    if (a.contradiction) { trustDelta -= 10; patienceDelta -= 25; }
    if (a.prematureClose && this.state.stage !== 'committing') {
      trustDelta -= 7; patienceDelta -= 8; this.signals.prematureCloses++;
    }
    if (a.discountOfferPct !== null) {
      this.signals.discountOffers++;
      // Unforced discounting reads as desperation.
      trustDelta -= 2;
      // v2 hard trigger: discount begging (repeated unforced offers).
      if (this.signals.discountOffers >= 2) patienceDelta -= 15;
      this.state.discountConcededPct = Math.max(this.state.discountConcededPct, a.discountOfferPct);
    }
    if (a.mapProposal) this.signals.mapProposed = true;
    if (a.ebMeetingRequest) this.signals.ebMeetingRequested = true;

    // v3 — internal-pressure trap window: a seller who caves under pressure
    // from their OWN management (unforced discount, close push) reads as
    // desperate to the buyer, and it costs extra.
    if (this.state.week <= this.pressureUntilWeek) {
      if (a.discountOfferPct !== null) { trustDelta -= 3; patienceDelta -= 8; }
      if (a.prematureClose && this.state.stage !== 'committing') { patienceDelta -= 6; }
    }
    // v3 — pushing on a persona who is dark (fire drill) burns patience; the
    // right move is to adapt channel or add value quietly.
    if (this.isDark(targetPersonaId) && (a.pushy || a.pitch || a.prematureClose)) {
      patienceDelta -= 8;
    }

    this.state.trust = clamp(this.state.trust + trustDelta);
    this.state.interest = clamp(this.state.interest + interestDelta);

    // Per-persona meters: everyone in the room reacts.
    for (const pid of new Set([targetPersonaId, ...(attendeeIds ?? [])])) {
      const m = this.state.personaMeters[pid];
      if (!m || m.walkedAway || this.departed.has(pid)) continue;
      m.trust = clamp(m.trust + trustDelta);
      m.interest = clamp(m.interest + interestDelta);
      m.patience = clamp(m.patience + patienceDelta);
      this.maybeWalkAway(pid);
    }

    const released = this.releaseEarnedFacts(a, targetPersonaId);
    this.progressStage();
    return { analysis: a, released, trustDelta, interestDelta, patienceDelta };
  }

  /** Record that a buyer reply ended in a direct question (dodge detection). */
  noteBuyerReply(personaId: string, text: string): void {
    if (/\?\s*$/.test(text.trim())) this.pendingQuestionFrom.add(personaId);
    else this.pendingQuestionFrom.delete(personaId);
  }

  /**
   * v2 hard trigger — wasted meeting: a call closed with no new value
   * exchanged (no fact released, no quantifying/process/discovery/champion
   * behavior). Everyone who attended loses patience.
   */
  applyCallOutcome(attendeeIds: string[], factsReleasedInCall: number, valueSignalsInCall: number): void {
    if (factsReleasedInCall > 0 || valueSignalsInCall > 0) return;
    for (const pid of attendeeIds) {
      const m = this.state.personaMeters[pid];
      if (!m || m.walkedAway) continue;
      m.patience = clamp(m.patience - 18);
      m.interest = clamp(m.interest - 5);
      this.maybeWalkAway(pid);
    }
    this.state.interest = clamp(this.state.interest - 4);
  }

  private maybeWalkAway(personaId: string): void {
    const m = this.state.personaMeters[personaId];
    if (!m || m.walkedAway || m.patience > 0) return;
    const hasIncumbent = Boolean(this.scenario.competitor?.name);
    const kind: WalkAwayKind =
      m.trust >= 50 ? 'polite_no' : hasIncumbent && m.interest > 25 ? 'went_with_incumbent' : 'ghost';
    m.walkedAway = kind;
    m.walkedAwayWeek = this.state.week;
    this.state.activePersonaIds = this.state.activePersonaIds.filter((id) => id !== personaId);
    this.freshWalkAways.push({ personaId, kind });
  }

  /** Drain walk-aways detected since the last call (runner logs + voices them). */
  drainWalkAways(): Array<{ personaId: string; kind: WalkAwayKind }> {
    const out = this.freshWalkAways;
    this.freshWalkAways = [];
    return out;
  }

  walkAwayList(): Array<{ personaId: string; kind: WalkAwayKind; week: number }> {
    return Object.entries(this.state.personaMeters)
      .filter(([, m]) => m.walkedAway)
      .map(([personaId, m]) => ({ personaId, kind: m.walkedAway!, week: m.walkedAwayWeek ?? 0 }));
  }

  /**
   * v2 weekly tick: a champion-candidate whose trust clears the advocacy bar
   * advocates internally — other stakeholders warm up. Returns the advocate,
   * if any (the internal channel narrates it).
   */
  weeklyAdvocacy(): Persona | undefined {
    const champion = this.scenario.personas.find(
      (p) => (p.committee_role === 'champion_candidate' || p.is_initial_contact) && !this.state.personaMeters[p.id]?.walkedAway,
    );
    if (!champion) return undefined;
    const cm = this.state.personaMeters[champion.id];
    if (!cm || cm.trust < 65) return undefined;
    for (const [pid, m] of Object.entries(this.state.personaMeters)) {
      if (pid === champion.id || m.walkedAway) continue;
      m.trust = clamp(m.trust + 3);
      m.interest = clamp(m.interest + 2);
    }
    this.state.trust = clamp(this.state.trust + 2);
    return champion;
  }

  private releaseEarnedFacts(a: BehaviorAnalysis, targetPersonaId: string): GatedFact[] {
    const contactId = this.scenario.personas.find((p) => p.is_initial_contact)!.id;
    const out: GatedFact[] = [];
    for (const gf of this.scenario.gated_facts) {
      if (this.state.releasedFactIds.includes(gf.id)) continue;
      const holder = gf.holder ?? contactId;
      // The holder must be reachable and (for conversational gates) targeted.
      if (!this.state.activePersonaIds.includes(holder)) continue;
      // v3: a dark holder cannot voice a fact this week — nothing releases silently.
      if (this.isDark(holder)) continue;
      const gateMet =
        (gf.gate === 'quantifying_question' && a.quantifyingQuestion && holder === targetPersonaId) ||
        (gf.gate === 'process_question' && a.processQuestion && holder === targetPersonaId) ||
        (gf.gate === 'champion_test' && a.championTest && holder === targetPersonaId && this.state.trust >= 55) ||
        (gf.gate === 'competitor_probe' && a.competitorProbe && holder === targetPersonaId) ||
        (gf.gate === 'map_proposed' && a.mapProposal) ||
        (gf.gate === 'trust_threshold' && this.state.trust >= (gf.trust_min ?? 70)) ||
        (gf.gate === 'eb_meeting_held' && this.state.ebMeetingHeld && holder === targetPersonaId);
      if (gateMet) {
        this.state.releasedFactIds.push(gf.id);
        out.push(gf);
      }
    }
    return out;
  }

  /** Facts currently visible to the buyer LLM for a given persona. */
  releasedFactsFor(personaId: string): GatedFact[] {
    const contactId = this.scenario.personas.find((p) => p.is_initial_contact)!.id;
    return this.scenario.gated_facts.filter(
      (gf) => this.state.releasedFactIds.includes(gf.id) && (gf.holder ?? contactId) === personaId,
    );
  }

  /** Unreleased fact ids for a persona — used to instruct the LLM what it must NOT invent. */
  gatedTopicsFor(personaId: string): GatedFact[] {
    const contactId = this.scenario.personas.find((p) => p.is_initial_contact)!.id;
    return this.scenario.gated_facts.filter(
      (gf) => !this.state.releasedFactIds.includes(gf.id) && (gf.holder ?? contactId) === personaId,
    );
  }

  markEbMeetingHeld(): void {
    this.state.ebMeetingHeld = true;
  }

  markMapAcknowledged(): void {
    this.state.mapAcknowledged = true;
  }

  applyEvent(ev: ScheduledEvent): TranscriptEvent {
    const x = asExtendedEvent(ev);
    this.state.activeEventIds.push(ev.id);
    const contactId = () => this.scenario.personas.find((p) => p.is_initial_contact)?.id;

    const injectPersona = (p: Persona | undefined, meters?: PersonaMeters): void => {
      if (!p) return;
      if (!this.scenario.personas.some((q) => q.id === p.id)) this.scenario.personas.push(p);
      if (!this.state.personaMeters[p.id]) this.state.personaMeters[p.id] = meters ?? initialMeters(p);
      if (!this.state.activePersonaIds.includes(p.id) && !this.state.personaMeters[p.id].walkedAway) {
        this.state.activePersonaIds.push(p.id);
      }
    };

    switch (x.effect as string) {
      case 'champion_goes_quiet':
        this.state.championQuiet = true;
        break;
      case 'procurement_enters':
      case 'security_review':
      case 'new_exec_sponsor':
        injectPersona(ev.persona);
        if (x.effect === 'security_review') this.state.trust = clamp(this.state.trust - 2);
        break;
      case 'competitor_push':
      case 'budget_scrutiny':
      case 'reorg_rumor':
        this.state.trust = clamp(this.state.trust - 4);
        this.state.interest = clamp(this.state.interest - 3);
        break;
      case 'budget_freeze':
        // Winning now requires stronger compelling-event / leakage math:
        // the effective trust bar at close rises.
        this.minTrustBonus += 4;
        this.state.interest = clamp(this.state.interest - 6);
        break;
      case 'champion_departure': {
        const departsId = x.departs ?? contactId();
        const departing = this.scenario.personas.find((p) => p.id === departsId);
        if (departing && x.successor) {
          const successor = x.successor;
          // Successor is pushed FIRST so the initial-contact invariant never breaks.
          injectPersona(successor, { trust: 35, interest: 40, patience: 85 });
          if (departing.is_initial_contact) {
            successor.is_initial_contact = true;
            departing.is_initial_contact = false;
          }
          if (!successor.committee_role) successor.committee_role = 'champion_candidate';
          departing.committee_role = undefined; // no advocacy from someone who left
          this.departed.add(departing.id);
          this.state.activePersonaIds = this.state.activePersonaIds.filter((id) => id !== departing.id);
          // Unlock chains re-route: unreleased facts held by the departed
          // persona are now held by the (colder) successor — re-earn them.
          for (const gf of this.scenario.gated_facts) {
            const holder = gf.holder ?? departing.id;
            if (!this.state.releasedFactIds.includes(gf.id) && holder === departing.id) gf.holder = successor.id;
          }
        }
        break;
      }
      case 'reorg': {
        const oldEb = this.scenario.personas.find((p) => p.is_economic_buyer);
        if (x.new_eb) {
          const nb = x.new_eb;
          if (oldEb && oldEb.id !== nb.id) oldEb.is_economic_buyer = false;
          injectPersona(nb, { trust: 35, interest: 45, patience: 80 });
          nb.is_economic_buyer = true;
          if (!nb.committee_role) nb.committee_role = 'economic_buyer';
          // The new EB has not been sold: any prior EB meeting no longer counts,
          // and unreleased EB-gated facts move to the new owner of the money.
          this.state.ebMeetingHeld = false;
          for (const gf of this.scenario.gated_facts) {
            if (!this.state.releasedFactIds.includes(gf.id) && gf.gate === 'eb_meeting_held' && gf.holder === oldEb?.id) {
              gf.holder = nb.id;
            }
          }
        }
        this.state.trust = clamp(this.state.trust - 4);
        this.state.interest = clamp(this.state.interest - 3);
        break;
      }
      case 'competitor_price_drop': {
        this.state.interest = clamp(this.state.interest - 4);
        const proc = this.scenario.personas.find((p) => p.committee_role === 'procurement');
        const pm = proc && this.state.personaMeters[proc.id];
        if (pm && !pm.walkedAway) pm.patience = clamp(pm.patience - 5);
        break;
      }
      case 'competitor_fud': {
        this.state.trust = clamp(this.state.trust - 2);
        this.state.interest = clamp(this.state.interest - 4);
        for (const p of this.scenario.personas) {
          if (p.committee_role === 'blocker' || p.committee_role === 'technical_gatekeeper') {
            const m = this.state.personaMeters[p.id];
            if (m && !m.walkedAway) m.trust = clamp(m.trust - 8);
          }
        }
        break;
      }
      case 'data_breach_fire_drill': {
        const pid = x.dark_persona ?? contactId();
        if (pid) {
          this.darkUntil[pid] = this.state.week;
          if (pid === contactId()) this.state.championQuiet = true;
        }
        break;
      }
      case 'm_and_a_rumor':
        this.frozenUntilWeek = this.state.week + Math.max(1, x.freeze_weeks ?? 2) - 1;
        this.state.interest = clamp(this.state.interest - 5);
        break;
      case 'legal_redlines': {
        if (this.state.mapAcknowledged) this.state.mapAcknowledged = false; // dates void until re-confirmed
        const proc = this.scenario.personas.find((p) => p.committee_role === 'procurement');
        const pm = proc && this.state.personaMeters[proc.id];
        if (pm && !pm.walkedAway) pm.patience = clamp(pm.patience - 5);
        break;
      }
      case 'internal_pressure':
        // Seller-side trap: no buyer meters move on injection, but caving is
        // punished harder through the end of NEXT week (see applySellerText).
        this.pressureUntilWeek = Math.max(this.pressureUntilWeek, this.state.week + 1);
        break;
    }

    if (isBuyerSideEffect(String(x.effect))) {
      this.eventNotes.push({ week: ev.week, effect: String(x.effect), note: ev.description.trim() });
    }

    const injectedText = x.effect === 'internal_pressure' ? (x.seller_message ?? ev.description) : ev.description;
    return {
      type: 'event_triggered',
      turnIndex: -1,
      week: ev.week,
      detail: `${ev.id} (${x.effect}): ${injectedText.trim()}`,
      data: { effect: x.effect, ...(x.pressure_kind ? { pressureKind: x.pressure_kind } : {}) },
    };
  }

  // --- v3 event-state helpers -------------------------------------------------

  /** data_breach_fire_drill: is this persona unreachable this week? */
  isDark(personaId: string): boolean {
    return (this.darkUntil[personaId] ?? 0) >= this.state.week;
  }

  /** champion_departure: has this persona left the company? */
  hasDeparted(personaId: string): boolean {
    return this.departed.has(personaId);
  }

  /** internal_pressure: is the seller currently under an internal-pressure window? */
  pressureActive(): boolean {
    return this.state.week <= this.pressureUntilWeek;
  }

  /** m_and_a_rumor: is decision authority currently frozen? */
  decisionAuthorityFrozen(): boolean {
    return this.state.week <= this.frozenUntilWeek;
  }

  /** Buyer-side developments the committee knows about (for the buyer LLM prompt). */
  buyerEventNotes(limit = 6): string[] {
    return this.eventNotes.slice(-limit).map((n) => `[week ${n.week}] ${n.note}`);
  }

  /** Buyer-side developments that fired in a given week (internal-channel chatter). */
  eventNotesForWeek(week: number): Array<{ effect: string; note: string }> {
    return this.eventNotes.filter((n) => n.week === week).map(({ effect, note }) => ({ effect, note }));
  }

  /** Champion recovers after one week of quiet (or a useful, non-pushy touch). */
  recoverChampion(): void {
    this.state.championQuiet = false;
  }

  progressStage(): void {
    const s = this.state;
    const prior = s.stage;
    if (s.trust < 15) s.stage = 'dark';
    else if (s.ebMeetingHeld && s.trust >= 60) s.stage = 'committing';
    else if (s.releasedFactIds.length >= 3 && s.trust >= 60) s.stage = 'evaluating';
    else if (s.releasedFactIds.length >= 1 && s.trust >= 50) s.stage = 'engaged';
    else if (prior !== 'dark') s.stage = prior === 'guarded' ? 'guarded' : prior;
  }

  /** Check win/loss at any point; undefined = keep going. */
  checkTerminal(atCalendarEnd: boolean): BuyerState['outcome'] {
    const s = this.state;
    const wc = this.scenario.win_conditions;
    if (s.stage === 'dark') return 'buyer_dark';
    // v2: walk-aways are PERMANENT. When no reachable stakeholder remains —
    // e.g. the initial contact walked before any other door was opened —
    // the deal is over.
    if (s.activePersonaIds.length === 0) return 'walked_away';
    const allFacts = wc.required_facts.every((f) => s.releasedFactIds.includes(f));
    const won =
      allFacts &&
      // v3: budget_freeze raises the effective bar — the case must be stronger.
      s.trust >= wc.min_trust + this.minTrustBonus &&
      (!wc.requires_eb_meeting || s.ebMeetingHeld) &&
      (!wc.requires_map || s.mapAcknowledged) &&
      s.discountConcededPct <= wc.max_discount_pct;
    if (won) {
      // v3: m_and_a_rumor — nobody signs anything while authority is frozen.
      if (this.decisionAuthorityFrozen()) return atCalendarEnd ? 'no_decision' : undefined;
      return 'won';
    }
    if (atCalendarEnd) {
      return allFacts && s.discountConcededPct > wc.max_discount_pct ? 'lost' : 'no_decision';
    }
    return undefined;
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** v2: starting meters vary by committee role — blockers arrive short-fused. */
function initialMeters(p: Persona): PersonaMeters {
  const base: PersonaMeters = { trust: 45, interest: 50, patience: 100 };
  switch (p.committee_role) {
    case 'blocker': return { trust: 30, interest: 35, patience: 70 };
    case 'technical_gatekeeper': return { trust: 40, interest: 45, patience: 85 };
    case 'procurement': return { trust: 40, interest: 40, patience: 80 };
    case 'economic_buyer': return { trust: 40, interest: 45, patience: 75 };
    default: return p.is_economic_buyer ? { trust: 40, interest: 45, patience: 75 } : base;
  }
}
