import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyerSim, buyerSimVersion, STATE_MACHINE_VERSION } from './buyer-sim.js';

test('buyerSim reports the model the buyer actually uses (default)', () => {
  const prev = process.env.BENCH_BUYER_MODEL;
  delete process.env.BENCH_BUYER_MODEL;
  const d = buyerSim();
  assert.equal(d.model, 'claude-sonnet-4-6');
  assert.equal(d.temperature, 0.8);
  assert.equal(d.stateMachineVersion, STATE_MACHINE_VERSION);
  if (prev !== undefined) process.env.BENCH_BUYER_MODEL = prev;
});

test('buyerSim honors BENCH_BUYER_MODEL override', () => {
  const prev = process.env.BENCH_BUYER_MODEL;
  process.env.BENCH_BUYER_MODEL = 'claude-opus-4-8';
  assert.equal(buyerSim().model, 'claude-opus-4-8');
  if (prev === undefined) delete process.env.BENCH_BUYER_MODEL;
  else process.env.BENCH_BUYER_MODEL = prev;
});

test('buyerSimVersion is a stable single-line descriptor', () => {
  const prev = process.env.BENCH_BUYER_MODEL;
  delete process.env.BENCH_BUYER_MODEL;
  assert.equal(buyerSimVersion(), 'claude-sonnet-4-6@t0.8+smv3');
  if (prev !== undefined) process.env.BENCH_BUYER_MODEL = prev;
});
