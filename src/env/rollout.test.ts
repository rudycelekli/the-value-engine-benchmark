import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../engine/scenario.js';
import { runFrontierRollout } from './rollout.js';
import { computeReward } from './reward.js';

const SC_DIR = 'scenarios';
const RUNS = '/tmp/veb-rollout-test';

test('mock rollout of the disciplined oracle produces a bar-clearing datapoint', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR);
  const dp = await runFrontierRollout({
    scenario, sellerSpec: 'scripted-disciplined', pack: false, seed: 1, runsDir: RUNS, mock: true,
  });

  assert.equal(dp.env.scenario_id, scenario.id);
  assert.equal(typeof dp.env.task_checksum, 'string');
  assert.equal(dp.env.task_checksum.length, 64);          // SHA-256 hex
  assert.equal(dp.model.spec, 'scripted-disciplined');
  assert.equal(dp.seed, 1);
  assert.equal(dp.buyer_sim, 'claude-sonnet-4-6@t0.8+smv3');
  assert.equal(dp.reward, 1);                              // oracle banks 1.0
  assert.equal(dp.resolved, true);
  assert.equal(dp.cleared_bar, true);                     // reward >= ORACLE_MIN
  assert.ok(dp.trajectory.turns > 0);
  assert.equal(dp.cost.usd, 0);                           // mock is free
  assert.equal(dp.transcript_ref, null);                  // no record in mock
  assert.ok(dp.id.includes('logistics-saas'));
  assert.ok(Array.isArray(dp.episode.turns));             // full trajectory carried
});

test('mock rollout of the naive floor does NOT clear the bar', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR);
  const dp = await runFrontierRollout({
    scenario, sellerSpec: 'scripted-baseline', pack: false, seed: 2, runsDir: RUNS, mock: true,
  });
  assert.equal(dp.cleared_bar, false);
  assert.ok(dp.reward < 0.5);
});

test('reward re-grades bit-for-bit from the frozen episode + grade (RLVR promise)', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR);
  // Two different policies exercise the won path AND the partial/vetoed path.
  for (const spec of ['scripted-disciplined', 'scripted-baseline']) {
    const dp = await runFrontierRollout({
      scenario, sellerSpec: spec, pack: false, seed: 3, runsDir: RUNS, mock: true,
    });
    // The datapoint freezes the grade the reward was computed from; re-running
    // the pure computeReward over the frozen (episode, grade) must reproduce the
    // stored scalar exactly — this is what a buyer runs to verify the reward.
    const regraded = computeReward(dp.episode, dp.grade, scenario.win_conditions);
    assert.equal(regraded.reward, dp.reward);
    assert.equal(regraded.vetoed, dp.reward_breakdown.vetoed);
    assert.deepEqual(regraded.criticalFailures, dp.reward_breakdown.criticalFailures);
  }
});
