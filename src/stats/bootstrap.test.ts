/**
 * Tests for the shared statistics primitives. Run with:
 *   npx tsx --test src/stats/bootstrap.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mean,
  std,
  median,
  pointBiserial,
  makeRng,
  bootstrapLiftCI,
  MIN_GROUP_N,
} from './bootstrap.js';

test('mean/std/median on known vectors', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(std([2, 2, 2]), 0);
  // sample std of [1,2,3,4,5] = sqrt(2.5)
  assert.ok(Math.abs(std([1, 2, 3, 4, 5]) - Math.sqrt(2.5)) < 1e-12);
  assert.equal(std([5]), 0);
});

test('pointBiserial: separable groups give strong positive correlation', () => {
  // group 1 has the high values, group 0 the low ones.
  const groups = [1, 1, 0, 0];
  const values = [10, 9, 1, 2];
  const r = pointBiserial(groups, values);
  assert.ok(r > 0.8, `expected strong positive, got ${r}`);
  // degenerate cases return 0
  assert.equal(pointBiserial([1, 1], [1, 1]), 0); // n < 3
  assert.equal(pointBiserial([1, 1, 1], [5, 5, 5]), 0); // no group-0 members
  assert.equal(pointBiserial([1, 0, 1], [3, 3, 3]), 0); // zero variance
});

test('makeRng is deterministic and seed-dependent', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  // values are in [0,1)
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  // a different seed diverges
  const c = makeRng(7);
  assert.notDeepEqual([c(), c(), c()], seqA.slice(0, 3));
});

test('bootstrapLiftCI: separated pair excludes 0, identical straddles 0', () => {
  const hi = Array.from({ length: 30 }, (_, i) => 100 + (i % 5)); // ~100
  const lo = Array.from({ length: 30 }, (_, i) => 10 + (i % 5)); // ~10
  const sep = bootstrapLiftCI(hi, lo);
  assert.ok(sep.lo > 0, `expected CI above 0, got [${sep.lo}, ${sep.hi}]`);

  const same = Array.from({ length: 30 }, (_, i) => 50 + (i % 7));
  const nul = bootstrapLiftCI(same, [...same]);
  assert.ok(nul.lo <= 0 && nul.hi >= 0, `expected CI to straddle 0, got [${nul.lo}, ${nul.hi}]`);
});

test('bootstrapLiftCI is seed-deterministic', () => {
  const g1 = [5, 6, 7, 8, 9, 10, 11, 12];
  const g0 = [1, 2, 3, 4, 5, 6, 7, 8];
  const first = bootstrapLiftCI(g1, g0);
  const second = bootstrapLiftCI(g1, g0);
  assert.deepEqual(first, second);
});

test('MIN_GROUP_N is the documented guardrail', () => {
  assert.equal(MIN_GROUP_N, 10);
});
