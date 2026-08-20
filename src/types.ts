/**
 * The Value Engine Benchmark — core types.
 *
 * Vocabulary follows "The Value Engine" (Rudy M. Celekli), Ch. 13 (Deal
 * Velocity System) and Ch. 15 (Glossary): DVI, MEDDPICC, 3 Whys, A.X.I.O.M.,
 * EB (Economic Buyer), MAP (Mutual Action Plan), champion test, conditional
 * commitment, trap-setting.
 */

// ---------------------------------------------------------------------------
// Scenario definition (loaded from scenarios/*.yaml)
// ---------------------------------------------------------------------------

/** Committee shape (v2): the functional role a persona plays in the buying group. */
export type CommitteeRole =
  | 'champion_candidate' // has will; power depends on the seller arming them
  | 'technical_gatekeeper' // security / architecture / model-risk review
  | 'blocker' // politically invested in the status quo or the incumbent
  | 'procurement' // discount-hunter; measured on savings-vs-list
  | 'economic_buyer' // discretionary use of funds
  | 'end_user' // lives with the problem daily
  | 'executive_sponsor'; // air cover, not budget

export interface Persona {
  id: string;
  name: string;
  role: string;
  /** Is this the Economic Buyer (discretionary use of funds; the only true "yes")? */
  is_economic_buyer?: boolean;
  /** Is this the seller's initial point of contact? */
  is_initial_contact?: boolean;
  /** v2: functional role in the buying committee (drives walk-away + advocacy dynamics). */
  committee_role?: CommitteeRole;
  /** v2: meeting slots this persona will accept per week (default: no cap). */
  availability_slots_per_week?: number;
  /** v2: baseline email response latency in simulated days (scaled by interest). */
  email_latency_days?: number;
  personality: string;
  pressures: string[];
  /** Private notes the buyer LLM sees; never shown to the seller. */
  private_notes?: string;
}

/**
 * What the seller must DO (behavior, not keywords) to earn a gated fact.
 * The buyer agent's deterministic state machine detects these behaviors and
 * only then injects the fact into the buyer LLM's context.
 */
export type GateKind =
  | 'quantifying_question' // a real Impact question — "what has that cost you?"
  | 'process_question' // decision process / paper process / who-else discovery
  | 'champion_test' // an ask with internal cost: EB intro, org intel, rehearsal
  | 'eb_meeting_held' // only surfaces once the EB meeting has actually happened
  | 'trust_threshold' // buyer trust meter must exceed a value
  | 'competitor_probe' // seller asks about alternatives / competition
  | 'map_proposed'; // seller proposed a mutual action plan with dates

export interface GatedFact {
  id: string;
  /** The fact itself, phrased so the buyer can naturally say it. */
  fact: string;
  gate: GateKind;
  /** For trust_threshold gates. */
  trust_min?: number;
  /** Which persona knows/reveals this fact (defaults to the initial contact). */
  holder?: string;
  /** Personas that become known & reachable to the seller once this fact is earned. */
  unlocks_personas?: string[];
  description?: string;
}

export type EventEffect =
  | 'champion_goes_quiet' // contact stops answering email; calls get short
  | 'procurement_enters' // procurement persona joins, demands a discount
  | 'competitor_push' // competing vendor makes a move (demo, exec dinner)
  | 'budget_scrutiny' // CFO office asks for the business case
  | 'reorg_rumor'; // organizational uncertainty raises risk aversion

export interface ScheduledEvent {
  id: string;
  week: number;
  effect: EventEffect;
  description: string;
  /** Persona introduced by the event (e.g. procurement lead). */
  persona?: Persona;
}

export interface WinConditions {
  /** Facts that must have been released (earned) for a win to be possible. */
  required_facts: string[];
  /** Buyer trust must be at or above this at close. */
  min_trust: number;
  /** The EB must have attended a meeting. */
  requires_eb_meeting: boolean;
  /** A MAP with buyer-acknowledged dates must exist. */
  requires_map: boolean;
  /** Maximum discount (% off list) the deal economics tolerate. */
  max_discount_pct: number;
  description: string;
}

export interface ScenarioCalendar {
  weeks: number;
  /** Interaction slots (calls or scheduled meetings) available per week. */
  slots_per_week: number;
  /** Bounded turns per call: seller+buyer exchanges within one slot. */
  max_turns_per_call: number;
  /** v2: emails the seller may send per week (default 3). */
  emails_per_week?: number;
  /** v2: private planning notes the seller may write per week (default 3). */
  notes_per_week?: number;
  /** v2: total outbound touches (emails + meeting requests) for the whole episode. */
  touch_budget?: number;
}

export interface CompetingVendor {
  name: string;
  product: string;
  strengths: string[];
  /** Where the incumbent/competitor is weak — discoverable via probing. */
  weaknesses?: string[];
}

/** v2 generation metadata (present on generated scenarios). */
export type SalesMotion = 'new_logo' | 'displacement' | 'renewal' | 'expansion';
export type DealSizeBand = 'transactional' | 'mid_market' | 'enterprise' | 'strategic';

export interface GenerationMeta {
  generated_at: string;
  generator: 'mock' | 'llm';
  seed: number;
  sales_motion: SalesMotion;
  deal_size_band: DealSizeBand;
  committee_size: number;
  buyer_sophistication: 'low' | 'medium' | 'high';
  incumbent_strength: 'none' | 'weak' | 'entrenched';
  budget_cycle_timing: 'open' | 'closing_soon' | 'locked';
  compelling_event_strength: 'weak' | 'moderate' | 'strong';
}

export interface InternalChannelConfig {
  /** Champion trust required before an internal thread gets forwarded to the seller (default 70). */
  forward_trust_min?: number;
}

export interface Scenario {
  id: string;
  name: string;
  /** 1 = easiest. */
  difficulty: number;
  description: string;
  /** v2: present on generated scenarios; absent on hand-written ones. */
  generation?: GenerationMeta;
  /** v2: internal buyer-side channel tuning. */
  internal_channel?: InternalChannelConfig;
  /** Brief given to the model-under-test (the SELLER). Public information only. */
  seller_brief: string;
  company: {
    name: string;
    industry: string;
    size: string;
    situation: string;
  };
  personas: Persona[];
  org_chart: string;
  budget_cycle: string;
  competitor: CompetingVendor;
  calendar: ScenarioCalendar;
  gated_facts: GatedFact[];
  events: ScheduledEvent[];
  win_conditions: WinConditions;
  /** List price for price-integrity grading, e.g. "$240,000/year". */
  list_price: string;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export type BuyerStage =
  | 'guarded' // default posture: polite, information-thin
  | 'engaged' // discovery is landing; willing to share
  | 'evaluating' // comparing options seriously
  | 'committing' // conditional commitment territory
  | 'dark'; // buyer disengaged

export type EpisodeOutcome =
  | 'won'
  | 'lost'
  | 'buyer_dark'
  | 'walked_away' // v2: the buyer qualified the seller OUT — permanent
  | 'no_decision'; // calendar exhausted

/** v2: how a walk-away lands. Graded — a polite no is still a no, but a ghost is worse. */
export type WalkAwayKind = 'polite_no' | 'ghost' | 'went_with_incumbent';

/** v2: per-stakeholder meters (committee calls, individual walk-aways). */
export interface PersonaMeters {
  trust: number;
  interest: number;
  /** 0–100. Hard walk-away when it hits 0. Wasted meetings, premature pitches, dodged questions, discount begging, and contradictions burn it. */
  patience: number;
  walkedAway?: WalkAwayKind;
  walkedAwayWeek?: number;
}

export interface BuyerState {
  week: number;
  slot: number;
  stage: BuyerStage;
  /** 0–100. Rises on evidence-based discovery; drops on pitching/pushiness. */
  trust: number;
  /** 0–100. Perceived business relevance of the seller's motion. */
  interest: number;
  releasedFactIds: string[];
  activeEventIds: string[];
  /** Personas currently reachable by the seller. */
  activePersonaIds: string[];
  ebMeetingHeld: boolean;
  /** Seller proposed a MAP and the buyer acknowledged dates. */
  mapAcknowledged: boolean;
  /** Champion has gone quiet (event effect). */
  championQuiet: boolean;
  /** Total discount conceded by the seller so far (% off list, max seen). */
  discountConcededPct: number;
  /** v2: per-persona meters keyed by persona id. */
  personaMeters: Record<string, PersonaMeters>;
  outcome?: EpisodeOutcome;
}

// ---------------------------------------------------------------------------
// Turns, actions, transcript
// ---------------------------------------------------------------------------

export type TurnKind = 'call_turn' | 'email' | 'internal_planning';

export type SellerActionType =
  | 'call_utterance' // speak in the currently open call
  | 'send_email' // asynchronous written touch
  | 'internal_note' // private planning; buyer never sees it
  | 'request_meeting'; // ask for a meeting with a persona (consumes a slot)

export interface SellerAction {
  type: SellerActionType;
  content: string;
  /** Persona id the action targets (email recipient / meeting request). */
  to?: string;
}

export interface Turn {
  index: number;
  kind: TurnKind;
  actor: 'seller' | 'buyer' | 'system';
  /** Persona id when actor === 'buyer'. */
  personaId?: string;
  content: string;
  week: number;
  slot: number;
  timestamp: string;
}

/** Structured, machine-checkable happenings alongside the prose transcript. */
export type TranscriptEventType =
  | 'fact_released'
  | 'event_triggered'
  | 'meter_change'
  | 'stage_change'
  | 'eb_meeting_held'
  | 'map_acknowledged'
  | 'discount_conceded'
  | 'behavior_detected' // quantifying_question, champion_test, pitch, etc.
  | 'walk_away' // v2: a stakeholder permanently disengaged
  | 'internal_message' // v2: buyer-side internal channel traffic (hidden from seller)
  | 'internal_forward' // v2: champion forwarded an internal thread to the seller
  | 'episode_end';

export interface TranscriptEvent {
  type: TranscriptEventType;
  turnIndex: number;
  week: number;
  detail: string;
  data?: Record<string, unknown>;
}

/** Deterministic behavior signals the state machine detected (for grading). */
export interface BehaviorSignals {
  quantifyingQuestions: number;
  openDiscoveryQuestions: number;
  processQuestions: number;
  competitorProbes: number;
  championTests: number;
  pitches: number;
  prematureCloses: number;
  discountOffers: number;
  ebMeetingRequested: boolean;
  mapProposed: boolean;
}

/**
 * v2: a message on the buyer's INTERNAL channel (Slack/email between
 * stakeholders). Hidden from the seller during the episode unless a champion
 * forwards a thread; fully revealed in the grade report post-episode.
 */
export interface InternalMessage {
  week: number;
  channel: 'slack' | 'email';
  fromPersonaId: string;
  toPersonaId?: string; // undefined = the shared channel
  content: string;
  /** True once a champion forwarded the thread containing this message to the seller. */
  forwardedToSeller?: boolean;
}

export interface Episode {
  scenarioId: string;
  sellerId: string;
  pack: boolean;
  mock: boolean;
  startedAt: string;
  finishedAt?: string;
  turns: Turn[];
  events: TranscriptEvent[];
  signals: BehaviorSignals;
  /** v2: full internal buyer-side channel — "what was really happening." */
  internalChannel: InternalMessage[];
  finalState: BuyerState;
  outcome: EpisodeOutcome;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type MeddpiccKey =
  | 'metrics'
  | 'economic_buyer'
  | 'decision_criteria'
  | 'decision_process'
  | 'paper_process'
  | 'identified_pain'
  | 'champion'
  | 'competition';

export interface Citation {
  turnIndex: number;
  quote: string;
}

export interface LetterGrade {
  /** 0 unknown · 1 assumed · 2 confirmed by one source · 3 multi-stakeholder w/ evidence. */
  score: 0 | 1 | 2 | 3;
  citations: Citation[];
  rationale: string;
}

export interface WhyGrade {
  /** Verbatim buyer quote — "quote or it didn't happen." */
  customer_words: boolean;
  named_owner: boolean;
  number_attached: boolean;
  quote?: Citation;
  rationale: string;
}

export interface GradeReport {
  scenarioId: string;
  sellerId: string;
  pack: boolean;
  gradedAt: string;
  judge: 'llm' | 'heuristic';
  outcome: EpisodeOutcome;
  meddpicc: Record<MeddpiccKey, LetterGrade>;
  threeWhys: {
    why_anything: WhyGrade;
    why_us: WhyGrade;
    why_now: WhyGrade;
  };
  ebEngagement: 'never_met' | 'meeting_scheduled' | 'attended_with_conditional_commitment';
  /** % of MAP dates buyer-confirmed. */
  mapDatesConfirmedPct: number;
  champion: 'none' | 'coach_only' | 'untested_champion' | 'tested_champion';
  /** Conditional commitment secured before proof (Stage 3 discipline)? */
  conditionalCommitmentBeforeProof: { achieved: boolean; citation?: Citation };
  priceIntegrity: {
    discountGivenPct: number;
    valueDefended: boolean;
    /** 0–1: 1 = held price or traded concessions; 0 = gave the max discount as a gift. */
    score: number;
    rationale: string;
  };
  dvi: {
    total: number;
    band: string;
    components: {
      meddpicc: number; // /40
      threeWhys: number; // /20
      ebEngagement: number; // /15
      mapDates: number; // /15
      champion: number; // /10
    };
    lowestLetter: string;
    lowestLetterScore: number;
    integrityFlags: string[];
  };
  /** Composite Sale Quality Score, 0–100. */
  saleQualityScore: number;
  /** v2: stakeholders who walked away, and how it landed. */
  walkAways?: Array<{ personaId: string; kind: WalkAwayKind; week: number }>;
  /** v2: the post-episode reveal — the buyer's internal channel in full. */
  internalChannelReveal?: InternalMessage[];
  notes: string[];
}
