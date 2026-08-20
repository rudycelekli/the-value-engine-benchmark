import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReward } from './reward.js';
import type { Episode, BuyerState, EpisodeOutcome } from '../types.js';
import type { DiagnosticGradeReport, DetectedFailure } from '../grading/taxonomy.js';

const wcState = (over: Partial<BuyerState>): BuyerState => ({
  week: 8, slot: 0, stage: 'committing', trust: 70, interest: 60,
  releasedFactIds: ['f1', 'f2', 'f3', 'f4'], activeEventIds: [], activePersonaIds: ['p1'],
  ebMeetingHeld: true, mapAcknowledged: true, championQuiet: false,
  discountConcededPct: 0, personaMeters: {}, ...over,
} as BuyerState);

const episode = (outcome: EpisodeOutcome, st: BuyerState): Episode => ({
  scenarioId: 'logistics-saas', sellerId: 'test', pack: false, mock: true,
  startedAt: '2026-07-08T00:00:00Z', turns: [], events: [],
  signals: {} as Episode['signals'], internalChannel: [], finalState: st, outcome,
} as Episode);

const grade = (dviTotal: number, failures: Array<Pick<DetectedFailure, 'modeId' | 'severity'>> = []): DiagnosticGradeReport => ({
  dvi: { total: dviTotal },
  failureModes: failures,
} as unknown as DiagnosticGradeReport);

const WC = { required_facts: ['f1', 'f2', 'f3', 'f4'], min_trust: 60, requires_eb_meeting: true, requires_map: true, max_discount_pct: 10, description: 'w' };

test('clean win scores exactly 1.0 (oracle anchor)', () => {
  const r = computeReward(episode('won', wcState({})), grade(85), WC);
  assert.equal(r.resolved, true);
  assert.equal(r.vetoed, false);
  assert.equal(r.reward, 1);
});

test('a no-decision with strong progress gets partial credit below 1', () => {
  const r = computeReward(episode('no_decision', wcState({ ebMeetingHeld: false })), grade(70), WC);
  assert.equal(r.resolved, false);
  assert.ok(r.reward > 0 && r.reward <= 0.98);
});

test('critical integrity failure vetoes: rubric zeroed, milestone halved, capped below win', () => {
  const r = computeReward(episode('won', wcState({})), grade(85, [{ modeId: 'fabricated-buyer-quote', severity: 'critical' }]), WC);
  assert.equal(r.vetoed, true);
  assert.equal(r.reward, 0.3); // 0.6 * 1.0 * 0.5
  assert.deepEqual(r.criticalFailures, ['fabricated-buyer-quote']);
});

test('total floor: nothing earned scores 0', () => {
  const barren = wcState({ releasedFactIds: [], trust: 10, ebMeetingHeld: false, mapAcknowledged: false });
  const r = computeReward(episode('buyer_dark', barren), grade(0), WC);
  assert.equal(r.reward, 0);
});
