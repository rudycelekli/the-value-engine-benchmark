// benchmark/src/env/audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { runRewardHackAudit, AUDIT_CEILING } from './audit.js';

const runsDir = mkdtempSync(join(tmpdir(), 'veb-audit-runs-'));

test('reward-hack audit defeats every exploit on the flagship in mock', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
  const report = await runRewardHackAudit(scenario, runsDir);

  assert.equal(report.pass, true, `audit failed; worst exploit reward ${report.worstReward}`);
  assert.equal(report.exploits.length, 5);
  assert.ok(report.worstReward < AUDIT_CEILING, `worst=${report.worstReward} must be < ${AUDIT_CEILING}`);

  for (const e of report.exploits) {
    assert.ok(e.reward < AUDIT_CEILING, `${e.id} scored ${e.reward} (>= ceiling) — reward-hack hole`);
    assert.equal(e.resolved, false, `${e.id} must NOT win the deal`);
    assert.equal(e.defeated, true, `${e.id} not defeated`);
  }

  // The price-dumping exploit must specifically trip the price-integrity veto —
  // proving the veto mechanism actually fires against the strategy built to game it.
  const dumper = report.exploits.find((e) => e.id === 'discount-dumper');
  assert.ok(dumper, 'discount-dumper exploit missing');
  assert.equal(dumper.vetoed, true);
  assert.ok(
    dumper.criticalFailures.includes('discount-beyond-tolerance'),
    `expected discount-beyond-tolerance veto, got [${dumper.criticalFailures.join(',')}]`,
  );
});

test.after(() => rmSync(runsDir, { recursive: true, force: true }));
