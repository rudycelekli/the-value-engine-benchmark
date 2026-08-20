import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { loadScenario } from '../engine/scenario.js';
import { runRolloutSuite } from './rollout-suite.js';

const SC_DIR = 'scenarios';
const OUT = '/tmp/veb-rollout-suite-test';

test('mock suite writes one jsonl datapoint per cell and a coherent report', async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  const scenarios = [loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR)];
  const report = await runRolloutSuite({
    scenarios,
    sellerSpecs: ['scripted-disciplined', 'scripted-baseline'],
    seeds: [1, 2],
    pack: false,
    runsDir: `${OUT}/runs`,
    budgetUsd: 1000,
    datasetPath: `${OUT}/dataset.jsonl`,
    mock: true,
  });

  // 1 env × 2 models × 2 seeds = 4 datapoints.
  assert.equal(report.datapoints, 4);
  assert.equal(report.cells.length, 4);
  assert.equal(report.stopped_on_budget, false);
  assert.equal(report.spent_usd, 0);

  const lines = readFileSync(`${OUT}/dataset.jsonl`, 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  const first = JSON.parse(lines[0]);
  assert.ok(first.id && first.reward !== undefined && Array.isArray(first.episode.turns));

  // Leaderboard: disciplined clears the bar every time, baseline never.
  const disc = report.leaderboard.find((r) => r.model === 'scripted-disciplined');
  const base = report.leaderboard.find((r) => r.model === 'scripted-baseline');
  assert.ok(disc && disc.clear_rate === 1);
  assert.ok(base && base.clear_rate === 0);

  // Env difficulty: solved by at least the disciplined oracle.
  const env = report.env_difficulty.find((e) => e.env.includes('logistics-saas'));
  assert.ok(env && env.empirically_solved === true);
  assert.ok(env.solved_by.includes('scripted-disciplined'));
});

test('concurrency across specs yields the same clean results as sequential', async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  const scenarios = [loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR)];
  const report = await runRolloutSuite({
    scenarios,
    sellerSpecs: ['scripted-disciplined', 'scripted-baseline'],
    seeds: [1, 2, 3],
    pack: false,
    runsDir: `${OUT}/runs`,
    budgetUsd: 1000,
    datasetPath: `${OUT}/dataset.jsonl`,
    mock: true,
    concurrency: 2, // fan across the two distinct specs
  });

  // 1 env × 2 specs × 3 seeds = 6 datapoints, none lost or duplicated.
  assert.equal(report.datapoints, 6);
  const lines = readFileSync(`${OUT}/dataset.jsonl`, 'utf8').trim().split('\n');
  assert.equal(lines.length, 6);

  // Per-spec results are identical to the sequential case — no cross-lane bleed.
  const disc = report.leaderboard.find((r) => r.model === 'scripted-disciplined');
  const base = report.leaderboard.find((r) => r.model === 'scripted-baseline');
  assert.ok(disc && disc.runs === 3 && disc.clear_rate === 1);
  assert.ok(base && base.runs === 3 && base.clear_rate === 0);
});

test('resume skips already-persisted cells, appends only new work, never truncates', async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  const scenarios = [loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR)];
  const base = {
    scenarios,
    sellerSpecs: ['scripted-disciplined', 'scripted-baseline'],
    pack: false,
    runsDir: `${OUT}/runs`,
    budgetUsd: 1000,
    datasetPath: `${OUT}/dataset.jsonl`,
    mock: true,
  };

  // First sweep: 2 specs × 2 seeds = 4 cells.
  await runRolloutSuite({ ...base, seeds: [1, 2] });
  const firstFour = readFileSync(`${OUT}/dataset.jsonl`, 'utf8').trim().split('\n');
  assert.equal(firstFour.length, 4);

  // Resume with a wider seed set: seeds 1–2 are skipped, only seed 3 is added.
  const report = await runRolloutSuite({ ...base, seeds: [1, 2, 3], resume: true });

  // 2 specs × 3 seeds = 6 total; the 4 originals are carried, 2 are new.
  assert.equal(report.datapoints, 6);
  const lines = readFileSync(`${OUT}/dataset.jsonl`, 'utf8').trim().split('\n');
  assert.equal(lines.length, 6);
  // The original 4 rows are byte-identical and still first — the file was appended, not rewritten.
  assert.deepEqual(lines.slice(0, 4), firstFour);

  // No (spec, seed) pair is duplicated across the resumed dataset.
  const keys = lines.map((l) => {
    const dp = JSON.parse(l);
    return `${dp.model.spec}:${dp.seed}`;
  });
  assert.equal(new Set(keys).size, 6);

  // Per-spec run counts reflect the full 3 seeds, not a re-run doubling.
  const disc = report.leaderboard.find((r) => r.model === 'scripted-disciplined');
  assert.ok(disc && disc.runs === 3);
});

test('budget cap stops the suite and flags it', async () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  const scenarios = [loadScenario('scenarios/01-logistics-saas.yaml', SC_DIR)];
  const report = await runRolloutSuite({
    scenarios,
    sellerSpecs: ['scripted-disciplined'],
    seeds: [1, 2, 3],
    pack: false,
    runsDir: `${OUT}/runs`,
    budgetUsd: 0, // zero budget → stop before the first paid cell
    datasetPath: `${OUT}/dataset.jsonl`,
    mock: false, // non-mock so the guard is live; scripted seller still $0
  });
  // With a $0 budget the guard trips immediately: no datapoints, stopped flag set.
  assert.equal(report.stopped_on_budget, true);
  assert.equal(report.datapoints, 0);
});
