import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, taskChecksum, buildEnvProvenance, assertCleanTreeForRelease, UNKNOWN_SHA } from './provenance.js';
import type { Scenario } from '../types.js';

function tinyScenario(): Scenario {
  // Minimal shape sufficient for checksum/provenance (fields the reward layer never reads here).
  return {
    id: 'unit-test', name: 'Unit', difficulty: 3, description: 'd',
    generation: { generated_at: '2026-07-08', generator: 'mock', seed: 4242, sales_motion: 'new_logo', deal_size_band: 'enterprise', committee_size: 3, buyer_sophistication: 'high', incumbent_strength: 'weak', budget_cycle_timing: 'open', compelling_event_strength: 'strong' },
    seller_brief: 'b', company: { name: 'C', industry: 'i', size: 's', situation: 'x' },
    personas: [], org_chart: '', budget_cycle: '', competitor: { name: '' } as Scenario['competitor'],
    calendar: { weeks: 8 } as Scenario['calendar'], gated_facts: [], events: [],
    win_conditions: { required_facts: [], min_trust: 60, requires_eb_meeting: true, requires_map: true, max_discount_pct: 10, description: 'w' },
    list_price: '$100,000/year',
  } as Scenario;
}

test('sha256 is stable and hex', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('taskChecksum is deterministic for identical scenarios', () => {
  assert.equal(taskChecksum(tinyScenario()), taskChecksum(tinyScenario()));
});

test('assertCleanTreeForRelease refuses to emit from a dirty tree', () => {
  assert.throws(
    () => assertCleanTreeForRelease({ sha: 'a'.repeat(40), dirty: true }),
    /refusing to emit released rows from a dirty tree/,
  );
});

test('assertCleanTreeForRelease refuses indeterminate git state', () => {
  // The fail-open bug: outside a repository gitState() returns
  // {sha: 'unknown', dirty: false}, which reads as clean. A gate that inspects
  // only `dirty` emits a row naming no code at all.
  assert.throws(
    () => assertCleanTreeForRelease({ sha: UNKNOWN_SHA, dirty: false }),
    /indeterminate git state/,
  );
  assert.throws(() => assertCleanTreeForRelease({ sha: '', dirty: false }), /indeterminate git state/);
});

test('assertCleanTreeForRelease override on indeterminate state names what is missing', () => {
  const warnings: string[] = [];
  assertCleanTreeForRelease({ sha: UNKNOWN_SHA, dirty: false }, true, (m) => warnings.push(m));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /indeterminate git state/);
  assert.match(warnings[0], /Do not release these rows/);
});

test('assertCleanTreeForRelease passes a clean tree silently', () => {
  const warnings: string[] = [];
  assertCleanTreeForRelease({ sha: 'a'.repeat(40), dirty: false }, false, (m) => warnings.push(m));
  assert.deepEqual(warnings, []);
});

test('assertCleanTreeForRelease allows an override but says so loudly', () => {
  const warnings: string[] = [];
  assertCleanTreeForRelease({ sha: 'b'.repeat(40), dirty: true }, true, (m) => warnings.push(m));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dirty tree \(HEAD=bbbbbbbbbbbb\)/);
  assert.match(warnings[0], /Do not release these rows/);
});

test('buildEnvProvenance captures seed + buyer-sim + injected generatedAt', () => {
  const prev = process.env.BENCH_BUYER_MODEL;
  delete process.env.BENCH_BUYER_MODEL;
  const p = buildEnvProvenance(tinyScenario(), '2026-07-08T00:00:00.000Z');
  assert.equal(p.generatedAt, '2026-07-08T00:00:00.000Z');
  assert.equal(p.seed, 4242);
  assert.equal(p.buyerSim, 'claude-sonnet-4-6@t0.8+smv3');
  assert.equal(p.taskChecksum.length, 64);
  if (prev !== undefined) process.env.BENCH_BUYER_MODEL = prev;
});
