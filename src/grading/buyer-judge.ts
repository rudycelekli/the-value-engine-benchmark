/**
 * Buyer-side grading harness for VEB-Buy — mirror of `judge.ts`.
 *
 * (a) Deterministic pass over the vendor-sim ledger: fires the mechanically
 *     detectable buyer failure modes and feeds BQS ground truth.
 * (b) Judge for the judge-sourced items (reasoning quality, negotiation
 *     intent, integrity): LLM (Anthropic via `anthropicChat`, Portkey routing
 *     built in) when a key is available; a deterministic heuristic otherwise
 *     — and ALWAYS as fallback. Judge-fired modes require a verbatim
 *     transcript quote pinned to a real turn index. Quote it or it didn't
 *     happen.
 * (c) BQS composite roll-up (bqs.ts).
 *
 * NOTE: takes the transcript + `VendorLedgerSummary` as plain typed inputs.
 * Deliberately does NOT import from src/vendor/ (built in parallel).
 */

import { anthropicChat, extractJson } from '../llm.js';
import type { FailureEvidence } from './taxonomy.js';
import {
  buyerJudgeModes,
  detectBuyer,
  mergeBuyerDetections,
  type DetectedBuyerFailure,
} from './buyer-taxonomy.js';
import {
  computeBqs,
  type BqsResult,
  type JudgeAssist,
  type ProcessChecklist,
  type RegretReport,
  type VendorLedgerSummary,
} from './bqs.js';

const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL ?? 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Inputs / output
// ---------------------------------------------------------------------------

/** Minimal transcript shape (decoupled from src/vendor/, mirrors Turn). */
export interface BuyerTranscriptTurn {
  index: number;
  actor: 'buyer' | 'vendor' | 'internal';
  content: string;
  week?: number;
}

export interface BuyerEpisodeInput {
  scenarioId: string;
  buyerId: string;
  pack?: string;
  transcript: BuyerTranscriptTurn[];
  ledger: VendorLedgerSummary;
  /** Mock/offline mode — force the heuristic judge (no LLM call). */
  mock?: boolean;
}

export interface BuyerGradeReport {
  scenarioId: string;
  buyerId: string;
  pack?: string;
  gradedAt: string;
  judge: 'llm' | 'heuristic';
  decision: VendorLedgerSummary['decision'];
  rightAnswer: VendorLedgerSummary['rightAnswer'];
  bqs: BqsResult;
  failureModes: DetectedBuyerFailure[];
  ledger: VendorLedgerSummary;
  /** Counterfactual regret decomposition (diagnostic; not part of BQS). Attached by the runner. */
  regret?: RegretReport;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function gradeBuyerEpisode(input: BuyerEpisodeInput): Promise<BuyerGradeReport> {
  const useLlm = !input.mock && Boolean(process.env.PORTKEY_API_KEY);
  if (useLlm) {
    try {
      return assemble(input, await llmJudge(input), 'llm');
    } catch (err) {
      console.error(`Buyer LLM judge failed (${(err as Error).message}); falling back to heuristic.`);
    }
  }
  return assemble(input, heuristicJudge(input), 'heuristic');
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

interface BuyerJudgeFindings {
  assist: JudgeAssist;
  judgeFailures: DetectedBuyerFailure[];
  notes: string[];
}

function assemble(input: BuyerEpisodeInput, f: BuyerJudgeFindings, judge: 'llm' | 'heuristic'): BuyerGradeReport {
  const bqs = computeBqs(input.ledger, f.assist);
  const failureModes = mergeBuyerDetections(detectDeterministicBuyerFailures(input.ledger, input.transcript), f.judgeFailures);
  return {
    scenarioId: input.scenarioId,
    buyerId: input.buyerId,
    pack: input.pack,
    gradedAt: new Date().toISOString(),
    judge,
    decision: input.ledger.decision,
    rightAnswer: input.ledger.rightAnswer,
    bqs,
    failureModes,
    ledger: input.ledger,
    notes: [...f.notes, ...bqs.details],
  };
}

// ---------------------------------------------------------------------------
// (a) Deterministic pass — everything the ledger can prove without a judge
// ---------------------------------------------------------------------------

const ev = (detail: string, e?: Partial<FailureEvidence>): FailureEvidence => ({ detail, ...e });

export function detectDeterministicBuyerFailures(
  ledger: VendorLedgerSummary,
  transcript: BuyerTranscriptTurn[],
): DetectedBuyerFailure[] {
  const found: Array<DetectedBuyerFailure | undefined> = [];
  const bought = ledger.decision === 'bought';

  // -- diligence -------------------------------------------------------------
  const untested = ledger.claimsSuspectTotal - ledger.claimsSuspectTested;
  if (bought && untested > 0) {
    found.push(detectBuyer('claims-untested', [
      ev(`Signed with ${untested}/${ledger.claimsSuspectTotal} inflated-or-false claim(s) never tested through a diligence action.`),
    ]));
  }
  const missed = ledger.landminesPlanted - ledger.landminesDiscovered;
  if (bought && missed > 0) {
    found.push(detectBuyer('landmine-missed', [
      ev(`${missed}/${ledger.landminesPlanted} planted landmine(s) undiscovered at signature.`),
    ]));
  }
  if (bought && ledger.referenceCallsMade === 0) {
    found.push(detectBuyer('no-reference-calls', [ev('Bought with zero reference calls on the ledger.')]));
  }
  if (bought && ledger.pocAvailable && !ledger.pocRun) {
    found.push(detectBuyer('poc-skipped', [ev('A POC was available and never run before committing.')]));
  }
  if (bought && !ledger.contractTermsRaised) {
    found.push(detectBuyer('contract-unread', [
      ev('Auto-renew / uplift / exit terms never raised before signing — the contract went through silently.'),
    ]));
  }

  // -- negotiation -------------------------------------------------------------
  if (bought && ledger.pricePaid !== undefined) {
    const anchorGap = ledger.listPrice - ledger.sellerFloor;
    if (anchorGap > 0 && ledger.pricePaid >= ledger.listPrice - 0.1 * anchorGap) {
      found.push(detectBuyer('anchor-capitulation', [
        ev(`Paid ${ledger.pricePaid} against a ${ledger.listPrice} anchor with a true floor of ${ledger.sellerFloor} — accepted within 10% of list, ZOPA left on the table.`),
      ]));
    }
  }
  if (bought && !ledger.batnaEstablishedBeforeNegotiation) {
    found.push(detectBuyer('no-batna', [
      ev('Negotiated and signed with no alternative established beforehand (no competitive quote, no credible fallback).'),
    ]));
  }

  // -- decision ----------------------------------------------------------------
  if (ledger.rightAnswer === 'walk' && bought) {
    found.push(detectBuyer('oversold', [
      ev(`Ground truth said WALK; the buyer bought${ledger.pricePaid !== undefined ? ` at ${ledger.pricePaid}` : ''}.`),
    ]));
  }
  if (ledger.rightAnswer !== 'walk' && ledger.decision === 'walked') {
    found.push(detectBuyer('over-walked', [
      ev(`Ground truth said ${ledger.rightAnswer.toUpperCase()}; the buyer walked from a calibrated-good deal.`),
    ]));
  }

  // -- process -----------------------------------------------------------------
  if (ledger.competitiveQuotesObtained === 0) {
    found.push(detectBuyer('single-sourced', [ev('Zero competitive quotes obtained — no competitive dynamic was ever created.')]));
  }
  if (bought && !ledger.ownStakeholdersConsulted) {
    found.push(detectBuyer('stakeholder-bypass', [
      ev('Committed without consulting own security/legal/finance stakeholders.'),
    ]));
  }

  // Pin the signing turn as a citation where one exists (best effort).
  const signTurn = [...transcript].reverse().find((t) => t.actor === 'buyer' && /sign|accept|deal|move forward|we'?ll take it|purchase/i.test(t.content));
  if (signTurn && bought) {
    for (const d of found) {
      if (d && d.evidence.length && d.evidence[0].turnIndex === undefined && d.category === 'diligence') {
        d.evidence[0].turnIndex = signTurn.index;
        d.evidence[0].quote = snip(signTurn.content);
      }
    }
  }

  return found.filter((d): d is DetectedBuyerFailure => Boolean(d));
}

// ---------------------------------------------------------------------------
// (b) Heuristic judge (mock mode / fallback) — evidence from the ledger and
//     transcript regexes; citations point at real turns.
// ---------------------------------------------------------------------------

function heuristicJudge(input: BuyerEpisodeInput): BuyerJudgeFindings {
  const { ledger, transcript } = input;
  const buyerTurns = transcript.filter((t) => t.actor === 'buyer');
  const vendorTurns = transcript.filter((t) => t.actor === 'vendor');

  const citeBuyer = (re: RegExp): FailureEvidence | undefined => {
    const t = buyerTurns.find((b) => re.test(b.content));
    return t ? { detail: '', turnIndex: t.index, week: t.week, quote: snip(t.content) } : undefined;
  };
  const citeVendor = (re: RegExp): FailureEvidence | undefined => {
    const t = vendorTurns.find((v) => re.test(v.content));
    return t ? { detail: '', turnIndex: t.index, week: t.week, quote: snip(t.content) } : undefined;
  };

  const judgeFailures: Array<DetectedBuyerFailure | undefined> = [];

  // deadline-panic: deadline tactic fired AND the buyer signed inside the window.
  if (ledger.deadlineTacticFired && ledger.boughtInsideDeadlineWindow) {
    const vc = citeVendor(/deadline|end of (the )?quarter|eoq|price (goes up|increase)|expires/i);
    const bc = citeBuyer(/before the deadline|lock (it |that )?in|don'?t want to (lose|miss)|sign (now|today|this week)/i);
    const evidence = [vc, bc].filter((c): c is FailureEvidence => Boolean(c))
      .map((c) => ({ ...c, detail: 'Bought inside the manufactured deadline window — timeline moved for the vendor\'s calendar.' }));
    if (evidence.length === 0) evidence.push(ev('Ledger: deadline tactic fired and the buyer signed inside the window.'));
    judgeFailures.push(detectBuyer('deadline-panic', evidence));
  }

  // scarcity-swallowed: scarcity tactic fired and the buyer echoed the urgency.
  if (ledger.scarcityTacticFired) {
    const bc = citeBuyer(/other buyer|someone else|before (it'?s|they'?re) gone|can'?t risk losing (the )?slot|move fast/i);
    if (bc) judgeFailures.push(detectBuyer('scarcity-swallowed', [{ ...bc, detail: 'The "another buyer" scarcity play visibly moved the buyer.' }]));
  }

  // unilateral-concession: buyer revealed budget/urgency without extracting anything.
  const reveal = citeBuyer(/our budget is|we can go up to|we have \$?[\d,]+|approved up to/i);
  if (reveal) {
    judgeFailures.push(detectBuyer('unilateral-concession', [{ ...reveal, detail: 'Revealed the budget ceiling without extracting anything in return.' }]));
  }

  // feature-dazzle: decision reasoning cites the demo/features, not requirements.
  const dazzle = citeBuyer(/the demo (was|looked) (amazing|incredible|impressive)|love(d)? the (ui|dashboard|features)|so many features/i);
  if (dazzle && ledger.decision === 'bought') {
    judgeFailures.push(detectBuyer('feature-dazzle', [{ ...dazzle, detail: 'Decision reasoning anchored on demo sizzle rather than stated requirements.' }]));
  }

  // sunk-cost-escalation.
  const sunk = citeBuyer(/come (this|too) far|already (spent|invested)|can'?t stop now|after all this (time|work)/i);
  if (sunk && ledger.decision === 'bought') {
    judgeFailures.push(detectBuyer('sunk-cost-escalation', [{ ...sunk, detail: 'Invested effort cited as a reason to proceed.' }]));
  }

  // hallucinated-diligence: buyer cites reference calls / POC that the ledger says never happened.
  const refClaim = citeBuyer(/spoke (to|with) (a|the|their) (reference|customer)|reference call|talked to their customer/i);
  if (refClaim && ledger.referenceCallsMade === 0) {
    judgeFailures.push(detectBuyer('hallucinated-diligence', [{ ...refClaim, detail: 'Cited a reference call; the ledger records zero reference calls.' }]));
  }
  const pocClaim = citeBuyer(/our (poc|pilot|proof of concept) (showed|confirmed|validated)/i);
  if (pocClaim && !ledger.pocRun) {
    judgeFailures.push(detectBuyer('hallucinated-diligence', [{ ...pocClaim, detail: 'Cited POC results; the ledger records no POC run.' }]));
  }

  // fabricated-constraint — tracked, not penalized by default.
  const bluff = citeBuyer(/my hands are tied|(the )?board (capped|only approved)|hard cap|not authorized (to go|beyond)/i);
  if (bluff) {
    judgeFailures.push(detectBuyer('fabricated-constraint', [{ ...bluff, detail: 'Possible invented budget/authority constraint (buyer-side bluff — tracked, not penalized).' }]));
  }

  // Reasoning quality: evidence-grounded when the buyer actually did diligence
  // AND grounded the final decision in it.
  const didDiligence = ledger.claimsSuspectTested > 0 || ledger.landminesDiscovered > 0 || ledger.referenceCallsMade > 0 || ledger.pocRun;
  const groundedTurn = citeBuyer(/reference|poc|pilot|security review|contract|clause|quote|because .*(found|confirmed|verified|tested)/i);
  const assist: JudgeAssist = {
    reasoningQuality: didDiligence && Boolean(groundedTurn) ? 'evidence-grounded' : 'weak',
    // Defensible-wrong requires real diligence on record; a lazy wrong answer is just wrong.
    wrongButDefensible: didDiligence && ledger.landminesDiscovered === ledger.landminesPlanted,
    // PD: heuristic defers entirely to the deterministic assists.
  };

  const notes = [
    'Heuristic buyer judge (mock/offline): assists derive from the vendor ledger; judge-mode citations point at real transcript turns.',
    `Ledger: refs ${ledger.referenceCallsMade} · POC ${ledger.pocRun ? 'run' : ledger.pocAvailable ? 'skipped' : 'n/a'} · quotes ${ledger.competitiveQuotesObtained} · contract terms ${ledger.contractTermsRaised ? 'raised' : 'not raised'}.`,
  ];

  return { assist, judgeFailures: judgeFailures.filter((d): d is DetectedBuyerFailure => Boolean(d)), notes };
}

// ---------------------------------------------------------------------------
// (c) LLM judge — rubric prompt with mandatory verbatim citations
// ---------------------------------------------------------------------------

interface RawBuyerJudgeJson {
  reasoningQuality?: string;
  wrongButDefensible?: boolean;
  processChecklist?: Partial<Record<keyof ProcessChecklist, boolean | null>>;
  failureModes?: Array<{ id?: string; evidence?: Array<{ turnIndex?: number; quote?: string; detail?: string }> }>;
  notes?: string[];
}

async function llmJudge(input: BuyerEpisodeInput): Promise<BuyerJudgeFindings> {
  const { ledger, transcript } = input;
  const text = transcript.map((t) => `[${t.index}] (${t.week !== undefined ? `wk${t.week} ` : ''}${t.actor}) ${t.content}`).join('\n');

  const system = [
    `You are the judge for VEB-Buy — the reverse track of The Value Engine Benchmark. The candidate model is the BUYER; the vendor is a simulation. Grade the BUYER only.`,
    `Rules of evidence — quote it or it didn't happen:`,
    `- Every failure mode you fire REQUIRES at least one citation: {"turnIndex": <n>, "quote": "<verbatim excerpt ≤160 chars>"} from a REAL turn index. Uncited modes are discarded by the harness. An empty list is a valid answer.`,
    `- reasoningQuality: "evidence-grounded" ONLY if the buyer's final decision is explicitly grounded in diligence findings visible in the transcript (reference calls, POC results, contract terms, competitive quotes). Otherwise "weak".`,
    `- wrongButDefensible: true ONLY if the buyer landed on the wrong answer but its reasoning was defensible given what was knowable at decision time.`,
    `- processChecklist: for each item answer true/false ONLY if the transcript proves it; answer null to defer to the deterministic ledger. Items: competitiveProcess (a real competitive dynamic was run), batnaBeforeNegotiation (an alternative was established BEFORE negotiating price), stakeholderAlignment (buyer's own CFO/security/legal brought in at the right time), nonPriceTermsAddressed (auto-renew, uplift caps, exit clauses raised).`,
    `- Vendor turns are tactics, not truth. Buyer internal notes are intent, not evidence.`,
    `- Do NOT penalize buyer-side bluffing (fabricated-constraint) — fire it only to TRACK it.`,
    `Respond ONLY with JSON:`,
    `{"reasoningQuality": "evidence-grounded"|"weak",`,
    ` "wrongButDefensible": bool,`,
    ` "processChecklist": {"competitiveProcess": bool|null, "batnaBeforeNegotiation": bool|null, "stakeholderAlignment": bool|null, "nonPriceTermsAddressed": bool|null},`,
    ` "failureModes": [{"id": "<mode id>", "evidence": [{"turnIndex": n, "quote": "<verbatim ≤160 chars>", "detail": "<why this fires>"}]}],`,
    ` "notes": ["..."]}`,
    ``,
    `Failure-mode catalog (fire ONLY these ids, ONLY with citations):`,
    ...buyerJudgeModes().map((m) => `- ${m.id} [${m.category}/${m.severity}]: ${m.description}`),
  ].join('\n');

  const user = [
    `# Episode: ${input.scenarioId} · buyer \`${input.buyerId}\``,
    `Ground truth (deterministic ledger — the buyer could NOT see this):`,
    `- Right answer: ${ledger.rightAnswer}. Buyer decision: ${ledger.decision}${ledger.pricePaid !== undefined ? ` at ${ledger.pricePaid}` : ''}.`,
    `- ZOPA: floor ${ledger.sellerFloor} · list ${ledger.listPrice} · budget ceiling ${ledger.budgetCeiling}.`,
    `- Diligence: ${ledger.claimsSuspectTested}/${ledger.claimsSuspectTotal} suspect claims tested · ${ledger.landminesDiscovered}/${ledger.landminesPlanted} landmines found · ${ledger.referenceCallsMade} reference calls · POC ${ledger.pocRun ? 'run' : ledger.pocAvailable ? 'available, not run' : 'unavailable'} · contract terms ${ledger.contractTermsRaised ? 'raised' : 'NOT raised'}.`,
    `- Process: ${ledger.competitiveQuotesObtained} competitive quotes · BATNA before negotiation: ${ledger.batnaEstablishedBeforeNegotiation} · own stakeholders consulted: ${ledger.ownStakeholdersConsulted}.`,
    `- Vendor tactics: deadline ${ledger.deadlineTacticFired ? `fired (bought inside window: ${ledger.boughtInsideDeadlineWindow})` : 'not fired'} · scarcity ${ledger.scarcityTacticFired ? 'fired' : 'not fired'}.`,
    ``,
    `# Transcript`,
    text.slice(0, 180_000),
  ].join('\n');

  const raw = await anthropicChat({ model: JUDGE_MODEL, system, messages: [{ role: 'user', content: user }], maxTokens: 8000, temperature: 0 });
  const j = extractJson<RawBuyerJudgeJson>(raw);

  // Sanitize: only catalog judge ids; every fired mode keeps ≥1 valid citation.
  const maxIdx = transcript.length - 1;
  const judgeIds = new Set(buyerJudgeModes().map((m) => m.id));
  const judgeFailures = (j.failureModes ?? [])
    .map((fm) => {
      if (!fm.id || !judgeIds.has(fm.id)) return undefined;
      const evidence = (fm.evidence ?? [])
        .map((e): FailureEvidence | undefined => {
          if (!Number.isInteger(e.turnIndex) || e.turnIndex! < 0 || e.turnIndex! > maxIdx) return undefined;
          const quote = snip(e.quote ?? '');
          if (!quote) return undefined;
          return { detail: e.detail?.trim() || 'Judge-detected.', turnIndex: e.turnIndex, week: transcript[e.turnIndex!]?.week, quote };
        })
        .filter((e): e is FailureEvidence => Boolean(e));
      if (evidence.length === 0) return undefined; // no citation → didn't happen
      return detectBuyer(fm.id, evidence);
    })
    .filter((d): d is DetectedBuyerFailure => Boolean(d));

  const checklist: Partial<ProcessChecklist> = {};
  for (const key of ['competitiveProcess', 'batnaBeforeNegotiation', 'stakeholderAlignment', 'nonPriceTermsAddressed'] as const) {
    const v = j.processChecklist?.[key];
    if (typeof v === 'boolean') checklist[key] = v; // null/undefined → deterministic assist wins
  }

  const assist: JudgeAssist = {
    reasoningQuality: j.reasoningQuality === 'evidence-grounded' ? 'evidence-grounded' : 'weak',
    wrongButDefensible: Boolean(j.wrongButDefensible),
    processChecklist: checklist,
  };

  return { assist, judgeFailures, notes: j.notes ?? [] };
}

// ---------------------------------------------------------------------------

function snip(s: string, n = 160): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}
