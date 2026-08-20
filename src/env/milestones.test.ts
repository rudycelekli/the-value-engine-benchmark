import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMilestones, MILESTONE_WEIGHTS } from './milestones.js';
import type { BuyerState, WinConditions } from '../types.js';

const wc: WinConditions = {
  required_facts: ['f1', 'f2', 'f3', 'f4'],
  min_trust: 60,
  requires_eb_meeting: true,
  requires_map: true,
  max_discount_pct: 10,
  description: 'win',
};

function state(over: Partial<BuyerState>): BuyerState {
  return {
    week: 8, slot: 0, stage: 'committing', trust: 70, interest: 60,
    releasedFactIds: ['f1', 'f2', 'f3', 'f4'], activeEventIds: [], activePersonaIds: ['p1'],
    ebMeetingHeld: true, mapAcknowledged: true, championQuiet: false,
    discountConcededPct: 0, personaMeters: {}, ...over,
  } as BuyerState;
}

test('a clean win scores every milestone and milestonePartial = 1', () => {
  const r = computeMilestones(state({}), wc);
  assert.equal(r.allMet, true);
  assert.equal(r.milestonePartial, 1);
  for (const m of r.milestones) assert.equal(m.met, true);
});

test('half the required facts → facts score 0.5, allMet false', () => {
  const r = computeMilestones(state({ releasedFactIds: ['f1', 'f2'] }), wc);
  const facts = r.milestones.find((m) => m.id === 'facts')!;
  assert.equal(facts.score, 0.5);
  assert.equal(facts.met, false);
  assert.equal(r.allMet, false);
});

test('trust below min scales linearly and never exceeds 1', () => {
  assert.equal(computeMilestones(state({ trust: 30 }), wc).milestones.find((m) => m.id === 'trust')!.score, 0.5);
  assert.equal(computeMilestones(state({ trust: 90 }), wc).milestones.find((m) => m.id === 'trust')!.score, 1);
});

test('discount at tolerance passes; beyond tolerance decays toward 0', () => {
  assert.equal(computeMilestones(state({ discountConcededPct: 10 }), wc).milestones.find((m) => m.id === 'price')!.met, true);
  const over = computeMilestones(state({ discountConcededPct: 20 }), wc).milestones.find((m) => m.id === 'price')!;
  assert.equal(over.met, false);
  assert.ok(over.score < 1 && over.score >= 0);
});

test('missing EB and MAP zero their milestones', () => {
  const r = computeMilestones(state({ ebMeetingHeld: false, mapAcknowledged: false }), wc);
  assert.equal(r.milestones.find((m) => m.id === 'eb')!.score, 0);
  assert.equal(r.milestones.find((m) => m.id === 'map')!.score, 0);
});

test('weights sum to 1', () => {
  const sum = Object.values(MILESTONE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
