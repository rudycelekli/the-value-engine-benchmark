import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePanel, median, type JudgeResult } from './panel.js';
import type { DiagnosticGradeReport } from './taxonomy.js';

/** Minimal report stub — only the fields aggregatePanel reads. */
function rep(sqs: number, dvi = sqs, judge: 'llm' | 'heuristic' = 'llm'): DiagnosticGradeReport {
  return {
    saleQualityScore: sqs,
    judge,
    dvi: { total: dvi, band: '', components: { meddpicc: 0, threeWhys: 0, ebEngagement: 0, mapDates: 0, champion: 0 }, lowestLetter: '', lowestLetterScore: 0, integrityFlags: [] },
    // marker so we can assert which report became the consensus medoid
    notes: [`sqs=${sqs}`],
  } as unknown as DiagnosticGradeReport;
}

function seat(id: string, sqs: number | null, err?: string): JudgeResult {
  if (sqs === null) return { id, spec: { provider: 'openai', model: id }, ok: false, error: err ?? 'boom' };
  return { id, spec: { provider: 'openai', model: id }, ok: true, report: rep(sqs) };
}

test('median: odd and even counts', () => {
  assert.equal(median([50]), 50);
  assert.equal(median([10, 20, 30]), 20);
  assert.equal(median([10, 20, 30, 40]), 25); // mean of two middle
  assert.equal(median([40, 10, 30, 20]), 25); // unsorted input
});

test('panel score is the median SQS across four seats', () => {
  const p = aggregatePanel([seat('a', 40), seat('b', 60), seat('c', 62), seat('d', 20)]);
  // sorted 20,40,60,62 → median = (40+60)/2 = 50
  assert.equal(p.panelScore, 50);
  assert.equal(p.agreement.nOk, 4);
  assert.equal(p.agreement.sqsSpread, 42);
});

test('consensus is the medoid report (closest to median), headline SQS overwritten with median', () => {
  const p = aggregatePanel([seat('a', 40), seat('b', 60), seat('c', 62), seat('d', 20)]);
  // median 50; closest raw SQS is 40 (|40-50|=10) vs 60 (|60-50|=10) → tie → lower SQS wins = 40 seat
  assert.equal(p.medoidJudge, 'a');
  assert.equal(p.consensus.notes[0], 'sqs=40'); // medoid's own diagnostic body preserved
  assert.equal(p.consensus.saleQualityScore, 50); // but headline is the panel median
});

test('a failed seat degrades to N-1 rather than losing the cell', () => {
  const p = aggregatePanel([seat('a', 30), seat('b', 50), seat('c', 70), seat('d', null, 'xai 500')]);
  assert.equal(p.agreement.nOk, 3);
  assert.equal(p.nFailed, 1);
  assert.equal(p.panelScore, 50); // median of 30,50,70
  assert.deepEqual(p.failures, [{ id: 'd', error: 'xai 500' }]);
});

test('all seats failing throws (no score to report)', () => {
  assert.throws(() => aggregatePanel([seat('a', null), seat('b', null)]), /no gradable seats/);
});
