import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { runDifficultyGate } from './gate.js';

test('flagship passes the difficulty-band gate in mock (oracle solvable, floor cannot)', async () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'veb-env-gate-'));
  try {
    const report = await runDifficultyGate(loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios'), runsDir);
    assert.equal(report.oraclePass, true, `oracle reward ${report.oracleReward} < 0.9`);
    assert.equal(report.floorPass, true, `floor reward ${report.floorReward} >= 0.5`);
    assert.equal(report.pass, true);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});
