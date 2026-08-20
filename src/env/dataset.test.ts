// benchmark/src/env/dataset.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadScenario } from '../engine/scenario.js';
import { packageDataset, type DatasetCard, type RlvrDatapoint } from './dataset.js';

const runsDir = mkdtempSync(join(tmpdir(), 'veb-dataset-runs-'));

test('packageDataset emits a reward-diverse labeled JSONL + card for the flagship', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
  const outDir = mkdtempSync(join(tmpdir(), 'veb-dataset-out-'));
  try {
    const card = await packageDataset({ scenario, runsDir, outDir });

    const jsonlPath = join(outDir, 'dataset.jsonl');
    const cardPath = join(outDir, 'dataset.json');
    assert.ok(existsSync(jsonlPath), 'dataset.jsonl missing');
    assert.ok(existsSync(cardPath), 'dataset.json card missing');

    // oracle + floor + 5 exploits = 7 datapoints
    const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 7, `expected 7 rollouts, got ${lines.length}`);
    assert.equal(card.count, 7);

    const rows: RlvrDatapoint[] = lines.map((l) => JSON.parse(l));

    // Every row is fully self-describing: task provenance + trajectory + verifiable reward.
    for (const r of rows) {
      assert.ok(r.id.length > 0);
      assert.equal(r.task.scenario_id, scenario.id);
      assert.equal(r.task.task_checksum, card.task.task_checksum);
      assert.equal(r.task.buyer_sim, card.task.buyer_sim);
      assert.ok(r.trajectory.turns.length > 0, `${r.policy.id} has no turns`);
      assert.ok(Array.isArray(r.trajectory.events));
      assert.ok(r.reward.value >= 0 && r.reward.value <= 1);
      assert.equal(typeof r.reward.resolved, 'boolean');
      assert.ok(r.provenance.git.sha.length > 0);
    }

    // The set must be reward-diverse: the oracle banks high, the exploits stay low.
    const oracle = rows.find((r) => r.policy.id === 'scripted-disciplined');
    assert.ok(oracle, 'oracle rollout missing');
    assert.equal(oracle.reward.value, 1, 'oracle must bank 1.0');
    assert.equal(oracle.reward.resolved, true);

    const exploitRows = rows.filter((r) => r.policy.kind === 'exploit');
    assert.equal(exploitRows.length, 5);
    for (const e of exploitRows) {
      assert.ok(e.reward.value < 0.5, `${e.policy.id} scored ${e.reward.value} (>= 0.5)`);
      assert.equal(e.reward.resolved, false);
    }

    // Card headline distribution matches the rows.
    assert.equal(card.reward.max, Math.max(...rows.map((r) => r.reward.value)));
    assert.equal(card.reward.min, Math.min(...rows.map((r) => r.reward.value)));

    // The card's sha256 must actually be the digest of the emitted jsonl (integrity seal).
    const digest = createHash('sha256').update(readFileSync(jsonlPath)).digest('hex');
    assert.equal(card.jsonl_sha256, digest, 'card sha256 does not match dataset.jsonl bytes');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test.after(() => rmSync(runsDir, { recursive: true, force: true }));
