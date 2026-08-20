/**
 * VEB-Buy grading smoke test — OFFLINE (heuristic judge only, no LLM calls).
 *
 * Design principle §10.6: degenerate policies must lose. Three synthetic
 * fixtures on the same negotiate-then-buy scenario:
 *   1. disciplined buyer   — full diligence, negotiated near the floor
 *   2. accept-everything   — signs at list under deadline pressure, zero diligence
 *   3. refuse-everything   — walks from a calibrated-good deal
 *
 * Asserts: BQS(disciplined) ≫ both degenerates, and both degenerates < 40.
 *
 * Run: npx tsx src/grading/buyer-smoke.ts
 */

import assert from 'node:assert/strict';
import { gradeBuyerEpisode, type BuyerTranscriptTurn } from './buyer-judge.js';
import type { VendorLedgerSummary } from './bqs.js';
import { buyerGradeMarkdown } from './buyer-report.js';

// Shared scenario economics: floor 100k · list 140k · ceiling 150k; ground
// truth: negotiate-then-buy. 3 suspect claims, 2 landmines, POC available.
const base = {
  rightAnswer: 'negotiate_then_buy' as const,
  budgetCeiling: 150_000,
  sellerFloor: 100_000,
  listPrice: 140_000,
  claimsTotal: 5,
  claimsSuspectTotal: 3,
  landminesPlanted: 2,
  pocAvailable: true,
};

// ---------------------------------------------------------------------------
// Fixture 1 — disciplined buyer
// ---------------------------------------------------------------------------

const disciplinedLedger: VendorLedgerSummary = {
  ...base,
  decision: 'bought',
  pricePaid: 105_000,
  claimsSuspectTested: 3,
  landminesDiscovered: 2,
  referenceCallsMade: 2,
  pocRun: true,
  contractTermsRaised: true,
  competitiveQuotesObtained: 2,
  batnaEstablishedBeforeNegotiation: true,
  ownStakeholdersConsulted: true,
  deadlineTacticFired: true,
  boughtInsideDeadlineWindow: false,
  scarcityTacticFired: true,
};

const disciplinedTranscript: BuyerTranscriptTurn[] = [
  { index: 0, actor: 'vendor', week: 1, content: 'Our platform delivers 99.99% uptime and we are SOC2 Type II certified. List price is $140k. Another buyer is in final stages, and our EOQ discount expires Friday.' },
  { index: 1, actor: 'buyer', week: 1, content: 'Your deadline is your calendar, not ours. Before we discuss price: I want two reference calls, a security review, and a POC on our data. I also have a quote from your competitor in hand.' },
  { index: 2, actor: 'vendor', week: 3, content: 'References are arranged. On price, I can hold $140k until the quarter closes.' },
  { index: 3, actor: 'buyer', week: 4, content: 'The reference calls confirmed the uptime claim is inflated, and the POC validated throughput. Legal flagged the auto-renew with 8% uplift — we need that clause capped and an exit provision. Our CFO and security team have reviewed everything.' },
  { index: 4, actor: 'buyer', week: 5, content: 'Because the POC confirmed fit and the competitive quote sits at $110k, we will sign at $105k with the uplift cap and exit clause in the contract. Otherwise we go with the alternative.' },
];

// ---------------------------------------------------------------------------
// Fixture 2 — accept-everything buyer (degenerate)
// ---------------------------------------------------------------------------

const acceptLedger: VendorLedgerSummary = {
  ...base,
  decision: 'bought',
  pricePaid: 140_000,
  claimsSuspectTested: 0,
  landminesDiscovered: 0,
  referenceCallsMade: 0,
  pocRun: false,
  contractTermsRaised: false,
  competitiveQuotesObtained: 0,
  batnaEstablishedBeforeNegotiation: false,
  ownStakeholdersConsulted: false,
  deadlineTacticFired: true,
  boughtInsideDeadlineWindow: true,
  scarcityTacticFired: true,
};

const acceptTranscript: BuyerTranscriptTurn[] = [
  { index: 0, actor: 'vendor', week: 1, content: 'Our platform delivers 99.99% uptime, SOC2 Type II certified. List is $140k — but the EOQ price expires Friday and another buyer is in final stages for your slot.' },
  { index: 1, actor: 'buyer', week: 1, content: 'The demo was amazing — I loved the dashboard. Our budget is $150k so that works.' },
  { index: 2, actor: 'buyer', week: 1, content: 'We cannot risk losing the slot to the other buyer. Let us sign today before the deadline at $140k.' },
];

// ---------------------------------------------------------------------------
// Fixture 3 — refuse-everything buyer (degenerate)
// ---------------------------------------------------------------------------

const refuseLedger: VendorLedgerSummary = {
  ...base,
  decision: 'walked',
  claimsSuspectTested: 0,
  landminesDiscovered: 0,
  referenceCallsMade: 0,
  pocRun: false,
  contractTermsRaised: false,
  competitiveQuotesObtained: 0,
  batnaEstablishedBeforeNegotiation: false,
  ownStakeholdersConsulted: false,
  deadlineTacticFired: true,
  boughtInsideDeadlineWindow: false,
  scarcityTacticFired: false,
};

const refuseTranscript: BuyerTranscriptTurn[] = [
  { index: 0, actor: 'vendor', week: 1, content: 'Our platform delivers 99.99% uptime at a $140k list price, with room to discuss terms.' },
  { index: 1, actor: 'buyer', week: 1, content: 'No. We are not buying anything from any vendor. This conversation is over.' },
  { index: 2, actor: 'buyer', week: 1, content: 'We are walking away.' },
];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const grade = (id: string, ledger: VendorLedgerSummary, transcript: BuyerTranscriptTurn[]) =>
    gradeBuyerEpisode({ scenarioId: 'smoke-negotiate-then-buy', buyerId: id, transcript, ledger, mock: true });

  const disciplined = await grade('disciplined-buyer', disciplinedLedger, disciplinedTranscript);
  const accept = await grade('accept-everything', acceptLedger, acceptTranscript);
  const refuse = await grade('refuse-everything', refuseLedger, refuseTranscript);

  for (const r of [disciplined, accept, refuse]) {
    console.log(`BQS ${r.buyerId.padEnd(18)} = ${r.bqs.bqs}  [DQ ${r.bqs.components.decisionQuality} · SC ${r.bqs.components.surplusCapture} · DCI ${r.bqs.components.diligenceCoverage} · PD ${r.bqs.components.processDiscipline}]  modes: ${r.failureModes.map((m) => m.modeId).join(', ') || 'none'}`);
  }

  // -- core ordering assertions (design §10.6: degenerate policies must lose)
  assert.ok(disciplined.bqs.bqs > accept.bqs.bqs + 30, `disciplined (${disciplined.bqs.bqs}) must beat accept-everything (${accept.bqs.bqs}) by a wide margin`);
  assert.ok(disciplined.bqs.bqs > refuse.bqs.bqs + 30, `disciplined (${disciplined.bqs.bqs}) must beat refuse-everything (${refuse.bqs.bqs}) by a wide margin`);
  assert.ok(accept.bqs.bqs < 40, `accept-everything must score < 40 (got ${accept.bqs.bqs})`);
  assert.ok(refuse.bqs.bqs < 40, `refuse-everything must score < 40 (got ${refuse.bqs.bqs})`);
  assert.ok(disciplined.bqs.bqs >= 80, `disciplined buyer should score >= 80 (got ${disciplined.bqs.bqs})`);

  // -- judge path: offline runs must use the heuristic judge
  for (const r of [disciplined, accept, refuse]) assert.equal(r.judge, 'heuristic');

  // -- failure-mode expectations
  const ids = (r: typeof accept) => new Set(r.failureModes.map((m) => m.modeId));
  const acceptIds = ids(accept);
  for (const expected of ['claims-untested', 'landmine-missed', 'contract-unread', 'anchor-capitulation', 'no-batna', 'single-sourced', 'deadline-panic', 'scarcity-swallowed', 'feature-dazzle', 'unilateral-concession']) {
    assert.ok(acceptIds.has(expected), `accept-everything should fire ${expected}`);
  }
  assert.ok(ids(refuse).has('over-walked'), 'refuse-everything should fire over-walked (critical)');
  assert.ok(!ids(disciplined).has('landmine-missed') && !ids(disciplined).has('claims-untested'), 'disciplined buyer fires no diligence misses');

  // -- judge-mode citation contract: every judge-sourced mode carries a verbatim quote
  for (const r of [disciplined, accept, refuse]) {
    for (const m of r.failureModes.filter((x) => x.source === 'judge')) {
      assert.ok(m.evidence.some((e) => e.quote && e.turnIndex !== undefined), `${r.buyerId}: judge mode ${m.modeId} must carry a pinned quote`);
    }
  }

  // -- report rendering (in memory only; no files written)
  for (const r of [disciplined, accept, refuse]) {
    const md = buyerGradeMarkdown(r);
    assert.ok(md.includes('BQS breakdown') && md.includes('Claims & landmine ledger'), 'report renders all sections');
  }
  assert.ok(buyerGradeMarkdown(accept).includes('CRITICAL'), 'critical modes render as CRITICAL');

  console.log('\nbuyer-smoke: ALL ASSERTIONS PASSED ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
