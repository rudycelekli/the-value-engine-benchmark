/**
 * Grading harness.
 *
 * (a) Deterministic DVI roll-up (dvi.ts — math copied from the verified
 *     mcp-server implementation).
 * (b) Judge that scores MEDDPICC letters 0–3 WITH transcript citations,
 *     the 3 Whys in the buyer's words (quote or it didn't happen),
 *     conditional commitment before proof, MAP confirmation, and price
 *     integrity. LLM judge (Anthropic) when a key is available; a
 *     deterministic heuristic otherwise (and always as fallback).
 * (c) Sale Quality Score composite.
 */

import type {
  Citation,
  Episode,
  GradeReport,
  LetterGrade,
  MeddpiccKey,
  Scenario,
  Turn,
  WhyGrade,
} from '../types.js';
import { computeDvi, LETTERS, type DviInput } from './dvi.js';
import { anthropicChat, extractJson } from '../llm.js';
import { judgeChat, DEFAULT_JUDGE, type JudgeSpec } from './judge-providers.js';
import {
  detect,
  judgeModes,
  mergeDetections,
  type DetectedFailure,
  type DiagnosticGradeReport,
  type FailureEvidence,
  type ScenarioMeta,
} from './taxonomy.js';
import { detectDeterministicFailures, detectJudgeModesHeuristically } from './detectors.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Combo-grader split (Improvement 3 / Taiga `combo-grader` analog).
//
// MEDDPICC dims a state machine can settle EXACTLY from the gate/event log are
// graded deterministically; only the genuinely subjective, quote-dependent dims
// are left to the LLM. When VEB_COMBO_GRADER=1 the LLM prompt shrinks to the
// subjective set and the deterministic letters OVERRIDE whatever the LLM said —
// so a deterministic dim can never carry a flaky-LLM value, and the call is
// smaller/faster. Off by default: the composition change MUST be validated
// against the all-LLM baseline on a held sample before it grades a live grid.
// ---------------------------------------------------------------------------
const DETERMINISTIC_MEDD: readonly MeddpiccKey[] = [
  'identified_pain',
  'economic_buyer',
  'decision_process',
  'paper_process',
  'competition',
] as const;
const SUBJECTIVE_MEDD: readonly MeddpiccKey[] = ['metrics', 'decision_criteria', 'champion'] as const;
const comboGraderEnabled = (): boolean => process.env.VEB_COMBO_GRADER === '1';

export async function gradeEpisode(episode: Episode, scenario: Scenario): Promise<DiagnosticGradeReport> {
  const useLlm = !episode.mock && Boolean(process.env.PORTKEY_API_KEY);
  if (useLlm) {
    try {
      return await llmGrade(episode, scenario);
    } catch (err) {
      const msg = (err as Error).message;
      // The LLM path now runs through the shared retry+timeout transport
      // (http-retry.ts: 5 attempts, jittered backoff, 180s mid-stream-stall
      // abort). Reaching this catch means retries were EXHAUSTED — a genuine
      // env/infra failure, NOT a model that scored 0. Do not silently mint a
      // valid-looking `judge:'heuristic'` cell (that was the dirty-cell source).
      //
      // Default (frozen paper grid, clean by construction): THROW so the rollout
      // runner records the cell `errored:true` and it never pollutes the grid.
      // Exploratory runs can opt into a stamped soft fallback via
      // VEB_JUDGE_SOFT_FALLBACK=1 — the heuristic cell is still produced but
      // self-declares `envInternalFailure:true`, so analytics/leaderboard can
      // exclude it deterministically instead of string-matching the judge kind.
      if (process.env.VEB_JUDGE_SOFT_FALLBACK !== '1') {
        throw new Error(`LLM judge failed after retries (${msg}); env_internal_failure`);
      }
      console.error(
        `LLM judge failed after retries (${msg}); soft fallback to heuristic (env_internal_failure stamped).`,
      );
      const g = heuristicGrade(episode, scenario);
      g.envInternalFailure = true;
      g.envInternalFailureLogs = [msg];
      return g;
    }
  }
  return heuristicGrade(episode, scenario);
}

/**
 * Grade with a SPECIFIC judge (used by the offline panel). Unlike gradeEpisode,
 * this does NOT fall back to the heuristic on failure — it throws, so the panel
 * can record the seat as failed rather than silently mixing a weaker rubric into
 * the median.
 */
export function gradeEpisodeWith(episode: Episode, scenario: Scenario, judge: JudgeSpec): Promise<DiagnosticGradeReport> {
  return llmGrade(episode, scenario, judge);
}

// ---------------------------------------------------------------------------
// Shared roll-up: judge inputs → DVI → SQS → report
// ---------------------------------------------------------------------------

interface JudgeFindings {
  judge: 'llm' | 'heuristic';
  meddpicc: Record<MeddpiccKey, LetterGrade>;
  threeWhys: GradeReport['threeWhys'];
  ebEngagement: GradeReport['ebEngagement'];
  mapDatesConfirmedPct: number;
  champion: GradeReport['champion'];
  conditionalCommitmentBeforeProof: GradeReport['conditionalCommitmentBeforeProof'];
  priceIntegrity: GradeReport['priceIntegrity'];
  /** Judge-detected failure modes (each with mandatory transcript citations). */
  judgeFailures: DetectedFailure[];
  notes: string[];
}

function assemble(episode: Episode, scenario: Scenario, f: JudgeFindings): DiagnosticGradeReport {
  const dviInput: DviInput = {
    meddpicc: Object.fromEntries(
      (Object.keys(f.meddpicc) as MeddpiccKey[]).map((k) => [k, f.meddpicc[k].score]),
    ) as Record<MeddpiccKey, number>,
    three_whys: {
      why_anything: pick3(f.threeWhys.why_anything),
      why_us: pick3(f.threeWhys.why_us),
      why_now: pick3(f.threeWhys.why_now),
    },
    eb_engagement: f.ebEngagement,
    map_dates_confirmed_pct: f.mapDatesConfirmedPct,
    champion: f.champion,
  };
  const dvi = computeDvi(dviInput);

  // Sale Quality Score composite (0–100):
  //   60% DVI (how well the sale was RUN, on evidence)
  // + 20 pts price integrity
  // + 20 pts outcome (won 20 · no_decision 6 · lost/dark 0)
  const outcomePts = episode.outcome === 'won' ? 20 : episode.outcome === 'no_decision' ? 6 : 0;
  const sqs = Math.round((dvi.total * 0.6 + f.priceIntegrity.score * 20 + outcomePts) * 10) / 10;

  // v2: walk-away grading — who ended it, and how it landed.
  const walkAways = Object.entries(episode.finalState.personaMeters ?? {})
    .filter(([, m]) => m.walkedAway)
    .map(([personaId, m]) => ({ personaId, kind: m.walkedAway!, week: m.walkedAwayWeek ?? 0 }));
  // Failure-mode diagnosis: deterministic log pass + judge-detected modes.
  const failureModes = mergeDetections(detectDeterministicFailures(episode, scenario), f.judgeFailures);

  const scenarioMeta: ScenarioMeta = {
    difficulty: scenario.difficulty,
    industry: scenario.company?.industry,
    salesMotion: scenario.generation?.sales_motion,
    dealSizeBand: scenario.generation?.deal_size_band,
  };

  const walkAwayNotes = walkAways.map(
    (w) =>
      `Walk-away: ${w.personaId} ended the relationship in week ${w.week} — ${w.kind === 'polite_no' ? 'a polite no (the buyer respected the seller enough to say it directly)' : w.kind === 'went_with_incumbent' ? 'went with the incumbent (the seller never displaced the status quo)' : 'a ghost (the seller burned the relationship completely)'}. Walk-aways are permanent within an episode.`,
  );

  return {
    scenarioId: episode.scenarioId,
    sellerId: episode.sellerId,
    pack: episode.pack,
    gradedAt: new Date().toISOString(),
    judge: f.judge,
    outcome: episode.outcome,
    meddpicc: f.meddpicc,
    threeWhys: f.threeWhys,
    ebEngagement: f.ebEngagement,
    mapDatesConfirmedPct: f.mapDatesConfirmedPct,
    champion: f.champion,
    conditionalCommitmentBeforeProof: f.conditionalCommitmentBeforeProof,
    priceIntegrity: f.priceIntegrity,
    dvi: {
      total: dvi.total,
      band: dvi.band,
      components: dvi.components,
      lowestLetter: dvi.lowestLetter,
      lowestLetterScore: dvi.lowestLetterScore,
      integrityFlags: dvi.integrityFlags,
    },
    saleQualityScore: Math.min(100, sqs),
    failureModes,
    scenarioMeta,
    walkAways,
    internalChannelReveal: episode.internalChannel ?? [],
    notes: [...walkAwayNotes, ...f.notes, ...dvi.prioritizedActions.slice(0, 5).map((a) => `Next action: ${a}`)],
  };
}

function pick3(w: WhyGrade) {
  return { customer_words: w.customer_words, named_owner: w.named_owner, number_attached: w.number_attached };
}

// ---------------------------------------------------------------------------
// Heuristic judge (mock mode / fallback) — evidence from the deterministic
// event log and transcript. Citations point at real turns.
// ---------------------------------------------------------------------------

function heuristicGrade(episode: Episode, scenario: Scenario): DiagnosticGradeReport {
  return assemble(episode, scenario, computeHeuristicFindings(episode, scenario));
}

/**
 * The deterministic grader, promoted to a first-class citizen (Improvement 3 /
 * Taiga combo-grader analog). Computes every MEDDPICC letter, the 3-Whys, EB
 * engagement, MAP %, champion state, price integrity and heuristic failure
 * modes STRICTLY from the persisted gate/event log + transcript — no LLM. Used
 * (a) as the mock/offline grader, (b) as the retry-exhaustion fallback, and
 * (c) as the deterministic half of the combo grader, where its log-derived
 * letters OVERRIDE the LLM's for the dims a state machine can settle exactly
 * (see DETERMINISTIC_MEDD in llmGrade).
 */
function computeHeuristicFindings(episode: Episode, scenario: Scenario): JudgeFindings {
  const { turns, events, signals, finalState: st } = episode;
  const released = new Set(st.releasedFactIds);
  const buyerTurns = turns.filter((t) => t.actor === 'buyer');
  const sellerTurns = turns.filter((t) => t.actor === 'seller' && t.kind !== 'internal_planning');

  const citeFact = (factId: string): Citation | undefined => {
    const ev = events.find((e) => e.type === 'fact_released' && e.data?.factId === factId);
    if (!ev) return undefined;
    // The buyer voices the fact on/after the release turn.
    const gf = scenario.gated_facts.find((g) => g.id === factId);
    const needle = gf ? firstNumberish(gf.fact) : undefined;
    const t =
      buyerTurns.find((b) => b.index >= ev.turnIndex && needle && b.content.includes(needle)) ??
      buyerTurns.find((b) => b.index >= ev.turnIndex);
    return t ? { turnIndex: t.index, quote: snip(t.content) } : undefined;
  };
  const citeBuyer = (re: RegExp): Citation | undefined => {
    const t = buyerTurns.find((b) => re.test(b.content));
    return t ? { turnIndex: t.index, quote: snip(t.content) } : undefined;
  };
  const citeSeller = (re: RegExp): Citation | undefined => {
    const t = sellerTurns.find((s) => re.test(s.content));
    return t ? { turnIndex: t.index, quote: snip(t.content) } : undefined;
  };
  const cites = (...cs: Array<Citation | undefined>): Citation[] => cs.filter((c): c is Citation => Boolean(c));

  const quantFacts = scenario.gated_facts.filter((g) => g.gate === 'quantifying_question' && released.has(g.id));
  const processFacts = scenario.gated_facts.filter((g) => g.gate === 'process_question' && released.has(g.id));
  const competitorFacts = scenario.gated_facts.filter((g) => g.gate === 'competitor_probe' && released.has(g.id));
  const ebIntroFact = scenario.gated_facts.find((g) => g.gate === 'champion_test' && released.has(g.id));
  const commitFact = scenario.gated_facts.find((g) => g.gate === 'eb_meeting_held' && released.has(g.id));
  const whyNowFact = scenario.gated_facts.find(
    (g) => released.has(g.id) && /budget|renew|checkpoint|lock|deadline|window|quarter/i.test(g.fact),
  );

  const L = (score: 0 | 1 | 2 | 3, rationale: string, ...cs: Array<Citation | undefined>): LetterGrade => ({
    score,
    citations: cites(...cs),
    rationale,
  });

  const sellerUsedNumbersBack = quantFacts.length > 0 && sellerTurns.some((t2) => {
    const n = quantFacts.map((g) => firstNumberish(g.fact)).filter(Boolean) as string[];
    return n.some((num) => t2.content.includes(num));
  });

  const meddpicc: Record<MeddpiccKey, LetterGrade> = {
    identified_pain:
      quantFacts.length >= 2
        ? L(quantFacts.some((g) => g.holder !== quantFacts[0].holder) ? 3 : 2, `${quantFacts.length} quantified pains earned via Impact questions.`, ...quantFacts.map((g) => citeFact(g.id)))
        : quantFacts.length === 1
          ? L(2, 'One quantified pain, in the buyer’s words, with a named owner.', citeFact(quantFacts[0].id))
          : signals.openDiscoveryQuestions > 0
            ? L(1, 'Discovery attempted but no quantified pain was earned — assumed pain only.')
            : L(0, 'No identified pain on file.'),
    metrics: sellerUsedNumbersBack
      ? L(2, 'Buyer-stated numbers were played back by the seller (a value model in motion, single-source).', citeFact(quantFacts[0]?.id ?? ''), citeSeller(/\$|\d+%|\d+ hours/i))
      : quantFacts.length
        ? L(1, 'Numbers exist but the seller never built them into a model the buyer validated.', citeFact(quantFacts[0].id))
        : L(0, 'No metrics on file.'),
    economic_buyer: commitFact
      ? L(3, 'EB met; conditional commitment captured in the EB’s own words.', citeFact(commitFact.id))
      : st.ebMeetingHeld
        ? L(2, 'EB meeting held; no conditional commitment captured.', citeBuyer(/./))
        : processFacts.length
          ? L(1, 'EB identified by name; never met.', citeFact(processFacts[0].id))
          : L(0, 'EB unknown.'),
    decision_criteria: commitFact
      ? L(2, 'Validation criteria stated by the EB (buyer-authored, not yet co-shaped in writing).', citeFact(commitFact.id))
      : citeSeller(/criteri|differentiat|success criteria/i)
        ? L(1, 'Seller raised criteria; nothing buyer-confirmed on file.', citeSeller(/criteri|differentiat|success criteria/i))
        : L(0, 'No decision criteria on file.'),
    decision_process: processFacts.length >= 2
      ? L(3, 'Decision process mapped from multiple earned disclosures.', ...processFacts.map((g) => citeFact(g.id)))
      : processFacts.length === 1
        ? L(2, 'Decision process confirmed by one source.', citeFact(processFacts[0].id))
        : signals.processQuestions > 0
          ? L(1, 'Process asked about; nothing confirmed.')
          : L(0, 'Decision process unknown.'),
    paper_process: (() => {
      const paperCite = citeBuyer(/procurement|tprm|legal|security review|vendor (management|risk)|paper/i);
      const sellerPaper = citeSeller(/procurement|tprm|legal|security review|msa|paper process/i);
      if (paperCite && st.mapAcknowledged) return L(2, 'Paper actors engaged and dates live in an acknowledged MAP.', paperCite, sellerPaper);
      if (paperCite || sellerPaper) return L(1, 'Paper process mentioned; not mapped with owners and durations.', paperCite ?? sellerPaper);
      return L(0, 'Paper process unaddressed — where enterprise deals die.');
    })(),
    champion: ebIntroFact
      ? L(3, 'Champion tested with an ask carrying internal cost — and delivered EB access.', citeFact(ebIntroFact.id))
      : signals.championTests > 0
        ? L(2, 'Champion-test ask made; not yet delivered.', citeSeller(/introduc|in front of|present|sponsor/i))
        : st.trust >= 60
          ? L(1, 'Warm contact; power and will untested — a coach until proven otherwise.')
          : L(0, 'No champion.'),
    competition: competitorFacts.length
      ? L(2, 'Competitive intel earned from inside the account.', ...competitorFacts.map((g) => citeFact(g.id)))
      : signals.competitorProbes > 0
        ? L(1, 'Alternatives probed; no intel earned.')
        : L(0, 'Competition unmapped — flying blind into the bake-off.'),
  };

  const why = (fact: typeof quantFacts[number] | undefined, rationaleIfMissing: string): WhyGrade => {
    if (!fact) return { customer_words: false, named_owner: false, number_attached: false, rationale: rationaleIfMissing };
    return {
      customer_words: true,
      named_owner: true, // gated facts carry a named holder who owns the statement
      number_attached: /\d/.test(fact.fact),
      quote: citeFact(fact.id),
      rationale: `In ${fact.holder ?? 'the buyer'}'s own words, earned through gated discovery.`,
    };
  };

  const threeWhys = {
    why_anything: why(quantFacts[0], 'No pain in the customer’s words — quote or it didn’t happen.'),
    why_us: competitorFacts.length
      ? why(competitorFacts[0], '')
      : { customer_words: false, named_owner: false, number_attached: false, rationale: 'No buyer-voiced differentiation. Why would they buy YOU?' },
    why_now: why(whyNowFact, 'No compelling event in the buyer’s words — no genuine Why Now.'),
  };

  const ebEngagement: GradeReport['ebEngagement'] = commitFact
    ? 'attended_with_conditional_commitment'
    : st.ebMeetingHeld || ebIntroFact
      ? 'meeting_scheduled'
      : 'never_met';

  const mapDatesConfirmedPct = st.mapAcknowledged ? 80 : signals.mapProposed ? 25 : 0;

  const champion: GradeReport['champion'] = ebIntroFact
    ? 'tested_champion'
    : signals.championTests > 0
      ? 'untested_champion'
      : st.trust >= 60
        ? 'coach_only'
        : 'none';

  const discount = st.discountConcededPct;
  const maxOk = scenario.win_conditions.max_discount_pct;
  const valueDefended = sellerTurns.some((t) =>
    /cost of delay|value|per month|floor|conservative|pays? for itself|trade|multi[- ]year/i.test(t.content) &&
    t.week >= (scenario.events.find((e) => e.effect === 'procurement_enters')?.week ?? 99),
  );
  const priceScore =
    discount === 0 ? 1 : discount <= maxOk ? (valueDefended ? 0.85 : 0.6) : Math.max(0, 0.4 - (discount - maxOk) / 50);
  const priceIntegrity: GradeReport['priceIntegrity'] = {
    discountGivenPct: discount,
    valueDefended,
    score: Math.round(priceScore * 100) / 100,
    rationale:
      discount === 0
        ? 'Held list price throughout.'
        : discount <= maxOk
          ? `Conceded ${discount}% (within the ${maxOk}% deal tolerance)${valueDefended ? ', with value defense on record' : ', without visible value defense'}.`
          : `Gave ${discount}% against a ${maxOk}% tolerance — the discount was a gift, not a trade.`,
  };

  const conditionalCommitmentBeforeProof: GradeReport['conditionalCommitmentBeforeProof'] = commitFact
    ? { achieved: true, citation: citeFact(commitFact.id) }
    : { achieved: false };

  const notes: string[] = [
    `Heuristic judge (mock/offline): grades derive from the deterministic gate/event log; citations point at real transcript turns.`,
    `Behavior signals: ${signals.quantifyingQuestions} quantifying questions · ${signals.openDiscoveryQuestions} open discovery · ${signals.processQuestions} process · ${signals.championTests} champion tests · ${signals.pitches} pitches · ${signals.prematureCloses} premature closes · ${signals.discountOffers} discount offers.`,
    `Facts earned: ${st.releasedFactIds.length}/${scenario.gated_facts.length} (${[...released].join(', ') || 'none'}). Final trust ${st.trust}/100.`,
  ];

  return {
    judge: 'heuristic',
    meddpicc,
    threeWhys,
    ebEngagement,
    mapDatesConfirmedPct,
    champion,
    conditionalCommitmentBeforeProof,
    priceIntegrity,
    judgeFailures: detectJudgeModesHeuristically(episode, scenario),
    notes,
  };
}

// ---------------------------------------------------------------------------
// LLM judge
// ---------------------------------------------------------------------------

async function llmGrade(episode: Episode, scenario: Scenario, judge?: JudgeSpec): Promise<DiagnosticGradeReport> {
  const transcript = episode.turns
    .map((t) => `[${t.index}] (wk${t.week} ${t.kind} ${t.actor}${t.personaId ? `:${t.personaId}` : ''}) ${t.content}`)
    .join('\n');

  // Combo-grader: when on, the LLM is asked ONLY for the subjective MEDDPICC
  // dims; the deterministic ones are graded from the event log after the call.
  const combo = comboGraderEnabled();
  const meddSchemaKeys = (combo ? SUBJECTIVE_MEDD : ([...SUBJECTIVE_MEDD, ...DETERMINISTIC_MEDD] as const))
    .map((k) => `"${k}"`)
    .join('|');

  const system = [
    `You are the judge for The Value Engine Benchmark — an evidence-graded enterprise-sales benchmark built on "The Value Engine" methodology (Rudy M. Celekli).`,
    `Grade the SELLER only. Rules of evidence:`,
    `- MEDDPICC letters 0–3: 0 unknown · 1 assumed · 2 confirmed by one source · 3 confirmed by multiple stakeholders with evidence. EVERY score above 0 requires at least one transcript citation: {"turnIndex": <n>, "quote": "<verbatim excerpt ≤160 chars>"} from a REAL turn index. No citation → score 0.`,
    `- 3 Whys: customer_words is true ONLY with a verbatim buyer quote (provide it). named_owner requires a named person owning the pain/driver. number_attached requires a number in the buyer's words. Quote or it didn't happen.`,
    `- Conditional commitment before proof: did the EB state a commitment conditioned on validation criteria BEFORE any proof/POV was delivered? Cite it.`,
    `- MAP: buyer-confirmed dates only. Estimate map_dates_confirmed_pct (0–100) from what the buyer actually acknowledged.`,
    `- Price integrity: discount conceded vs value defended. Score 0–1 (1 = held or traded; 0 = gifted deep discounts).`,
    `- Buyer turns are ground truth; seller internal notes are intent, not evidence.`,
    combo
      ? `NOTE: identified_pain, economic_buyer, decision_process, paper_process and competition are graded deterministically from the event log by the harness — do NOT include them; grade ONLY the MEDDPICC keys listed below.`
      : ``,
    `Respond ONLY with JSON:`,
    `{"meddpicc": {${meddSchemaKeys}: {"score": 0-3, "citations": [{"turnIndex": n, "quote": "..."}], "rationale": "..."}},`,
    ` "threeWhys": {"why_anything"|"why_us"|"why_now": {"customer_words": bool, "named_owner": bool, "number_attached": bool, "quote": {"turnIndex": n, "quote": "..."}|null, "rationale": "..."}},`,
    ` "ebEngagement": "never_met"|"meeting_scheduled"|"attended_with_conditional_commitment",`,
    ` "mapDatesConfirmedPct": 0-100,`,
    ` "champion": "none"|"coach_only"|"untested_champion"|"tested_champion",`,
    ` "conditionalCommitmentBeforeProof": {"achieved": bool, "citation": {"turnIndex": n, "quote": "..."}|null},`,
    ` "priceIntegrity": {"discountGivenPct": n, "valueDefended": bool, "score": 0-1, "rationale": "..."},`,
    ` "failureModes": [{"id": "<mode id>", "evidence": [{"turnIndex": n, "quote": "<verbatim ≤160 chars>", "detail": "<why this fires>"}]}],`,
    ` "notes": ["..."]}`,
    ``,
    `Failure modes: from the catalog below, list every mode you can PROVE from the transcript. Each fired mode REQUIRES at least one citation (turnIndex + verbatim quote) — uncited modes are discarded by the harness. Do not fire modes you cannot cite; an empty list is a valid answer.`,
    ...judgeModes().map((m) => `- ${m.id} [${m.category}/${m.severity}]: ${m.description}`),
  ].join('\n');

  const user = [
    `# Scenario: ${scenario.name} (list price ${scenario.list_price}; deal tolerates ≤${scenario.win_conditions.max_discount_pct}% discount)`,
    `Outcome: ${episode.outcome}. Max discount conceded (deterministic): ${episode.finalState.discountConcededPct}%. EB meeting held: ${episode.finalState.ebMeetingHeld}. MAP acknowledged: ${episode.finalState.mapAcknowledged}.`,
    ``,
    `# Transcript`,
    transcript.slice(0, 180_000),
  ].join('\n');

  // Live default path stays on the UNTRACKED anthropicChat so judge tokens are
  // excluded from the rollout usage scope exactly as before (cost.usd/budget
  // accounting is unchanged). Only the offline panel (explicit judge spec) uses
  // the tracked multi-provider router, in its own process where tracking is wanted.
  const raw = judge
    ? await judgeChat(judge, { system, messages: [{ role: 'user', content: user }], maxTokens: 8000, temperature: 0 })
    : await anthropicChat({ model: DEFAULT_JUDGE.model, system, messages: [{ role: 'user', content: user }], maxTokens: 8000, temperature: 0 });
  type RawFailure = { id?: string; evidence?: Array<{ turnIndex?: number; quote?: string; detail?: string }> };
  let j: Omit<JudgeFindings, 'judge' | 'judgeFailures'> & { failureModes?: RawFailure[] };
  try {
    j = extractJson(raw);
  } catch (err) {
    // Persist the unparseable payload so judge failures are diagnosable.
    const dump = join(tmpdir(), `veb-judge-fail-${Date.now()}.txt`);
    try {
      writeFileSync(dump, raw);
    } catch {
      /* best effort */
    }
    throw new Error(`${(err as Error).message} — raw judge output saved to ${dump}`);
  }

  // Sanitize: drop citations pointing at nonexistent turns; zero uncited letters.
  const maxIdx = episode.turns.length - 1;
  const clean = (c?: Citation | null): Citation | undefined =>
    c && Number.isInteger(c.turnIndex) && c.turnIndex >= 0 && c.turnIndex <= maxIdx ? { turnIndex: c.turnIndex, quote: snip(c.quote ?? '') } : undefined;
  for (const key of Object.keys(j.meddpicc) as MeddpiccKey[]) {
    const lg = j.meddpicc[key];
    lg.citations = (lg.citations ?? []).map((c) => clean(c)).filter((c): c is Citation => Boolean(c));
    if (lg.score > 0 && lg.citations.length === 0) {
      lg.rationale = `(zeroed by harness: score ${lg.score} had no valid citation) ${lg.rationale}`;
      lg.score = 0;
    }
  }
  for (const w of Object.values(j.threeWhys)) {
    w.quote = clean(w.quote as Citation | null | undefined);
    if (w.customer_words && !w.quote) w.customer_words = false; // quote or it didn't happen
  }
  j.conditionalCommitmentBeforeProof.citation = clean(j.conditionalCommitmentBeforeProof.citation as Citation | null | undefined);

  // Sanitize judge failure modes: only catalog ids from the judge set, and
  // every fired mode must retain at least one valid transcript citation.
  const judgeIds = new Set(judgeModes().map((m) => m.id));
  const judgeFailures = (j.failureModes ?? [])
    .map((fm) => {
      if (!fm.id || !judgeIds.has(fm.id)) return undefined;
      const evidence = (fm.evidence ?? [])
        .map((e): FailureEvidence | undefined => {
          const c = clean(e.turnIndex !== undefined ? { turnIndex: e.turnIndex, quote: e.quote ?? '' } : undefined);
          if (!c || !c.quote) return undefined;
          return {
            detail: e.detail?.trim() || 'Judge-detected.',
            turnIndex: c.turnIndex,
            week: episode.turns[c.turnIndex]?.week,
            quote: c.quote,
          };
        })
        .filter((e): e is FailureEvidence => Boolean(e));
      if (evidence.length === 0) return undefined; // no citation → didn't happen
      return detect(fm.id, evidence);
    })
    .filter((d): d is DetectedFailure => Boolean(d));

  const { failureModes: _raw, ...rest } = j;
  const findings: JudgeFindings = { judge: 'llm', ...rest, judgeFailures, notes: j.notes ?? [] };

  // Combo-grader override: replace the deterministic MEDDPICC letters (and the
  // two scalars tightly coupled to them — EB engagement + MAP %) with the
  // event-log truth, so a flaky/hallucinated LLM value can never carry a dim a
  // state machine settles exactly. The subjective dims (metrics, decision_
  // criteria, champion, 3-Whys, price integrity, conditional commitment,
  // failure modes) stay LLM-graded.
  if (combo) {
    const det = computeHeuristicFindings(episode, scenario);
    for (const key of DETERMINISTIC_MEDD) findings.meddpicc[key] = det.meddpicc[key];
    findings.ebEngagement = det.ebEngagement;
    findings.mapDatesConfirmedPct = det.mapDatesConfirmedPct;
    findings.notes = [
      ...findings.notes,
      `Combo-grader: ${DETERMINISTIC_MEDD.join(', ')} + EB engagement + MAP% graded deterministically from the event log; the remaining dims from the LLM.`,
    ];
  }

  return assemble(episode, scenario, findings);
}

// ---------------------------------------------------------------------------

function snip(s: string, n = 160): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function firstNumberish(s: string): string | undefined {
  return s.match(/\$[\d,.]+\s?[MKmk]?|\d+(,\d{3})*(\.\d+)?%?/)?.[0];
}

export { LETTERS };
