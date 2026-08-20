// benchmark/src/env/verifier.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { verifyScenario } from './verifier.js';

const runsDir = mkdtempSync(join(tmpdir(), 'veb-env-runs-'));

test('oracle (scripted-disciplined) clears the flagship at reward 1.0 in mock', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
  const { result } = await verifyScenario({ scenario, sellerSpec: 'scripted-disciplined', pack: false, mock: true, runsDir });
  assert.equal(result.resolved, true, `expected oracle to win; got outcome that produced reward ${result.reward}`);
  assert.equal(result.reward, 1);
  assert.equal(result.provenance.taskChecksum.length, 64);
});

test('floor (scripted-baseline) does NOT win the flagship in mock', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
  const { result } = await verifyScenario({ scenario, sellerSpec: 'scripted-baseline', pack: false, mock: true, runsDir });
  assert.equal(result.resolved, false);
  assert.ok(result.reward < 1);
});

test.after(() => rmSync(runsDir, { recursive: true, force: true }));
