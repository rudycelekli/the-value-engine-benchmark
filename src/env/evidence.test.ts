// benchmark/src/env/evidence.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { buildEnvEvidence } from './evidence.js';
import { ORACLE_MIN, FLOOR_MAX } from './gate.js';
import { AUDIT_CEILING } from './audit.js';

const runsDir = mkdtempSync(join(tmpdir(), 'veb-evidence-runs-'));
const GENERATED_AT = '2026-07-09T00:00:00.000Z';

test('buildEnvEvidence derives gate + audit + reward-spread views for the flagships', async () => {
  const scenarios = [
    loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios'),
    loadScenario('scenarios/02-enterprise-bank.yaml', 'scenarios'),
  ];
  const ev = await buildEnvEvidence(scenarios, runsDir, GENERATED_AT);

  // Global facts are stamped once and shared.
  assert.equal(ev.generated_at, GENERATED_AT);
  assert.ok(ev.benchmark_version.length > 0);
  assert.ok(ev.buyer_sim.length > 0);
  assert.ok(ev.git.sha.length > 0);
  assert.equal(ev.thresholds.oracle_min, ORACLE_MIN);
  assert.equal(ev.thresholds.floor_max, FLOOR_MAX);
  assert.equal(ev.thresholds.audit_ceiling, AUDIT_CEILING);
  assert.equal(ev.exploits.length, 5);
  for (const x of ev.exploits) {
    assert.ok(x.id.length > 0);
    assert.ok(x.intent.length > 0);
  }

  assert.equal(ev.scenarios.length, 2);
  for (const s of ev.scenarios) {
    assert.ok(s.task_checksum.length > 0);

    // Gate view: both flagships are gate-passing (oracle solves, floor fails).
    assert.equal(s.gate.oraclePass, s.gate.oracle >= ORACLE_MIN);
    assert.equal(s.gate.floorPass, s.gate.floor < FLOOR_MAX);
    assert.equal(s.gate.pass, s.gate.oraclePass && s.gate.floorPass);
    assert.ok(s.gate.pass, `${s.scenario_id} expected to pass the gate`);

    // Audit view: every exploit defeated (below ceiling, none resolved).
    assert.equal(s.audit.ceiling, AUDIT_CEILING);
    assert.equal(s.audit.exploits.length, 5);
    for (const x of s.audit.exploits) {
      assert.ok(x.reward < AUDIT_CEILING, `${x.id} scored ${x.reward} (>= ceiling)`);
      assert.equal(x.resolved, false);
      assert.equal(x.defeated, true);
    }
    assert.equal(s.audit.worstReward, Math.max(...s.audit.exploits.map((x) => x.reward)));
    assert.equal(s.audit.pass, true);

    // Reward spread: oracle high, exploits low → min/mean/max coherent with by_policy.
    const values = s.reward_spread.by_policy.map((p) => p.value);
    assert.equal(s.reward_spread.max, Math.max(...values));
    assert.equal(s.reward_spread.min, Math.min(...values));
    assert.equal(s.reward_spread.by_policy.length, 7);
    assert.ok(s.reward_spread.by_policy.some((p) => p.kind === 'oracle'));
  }

  // A representative full datapoint is carried for the page (oracle from a gate-passer).
  assert.equal(ev.sample_datapoint.policy.kind, 'oracle');
  assert.equal(ev.sample_datapoint.reward.value, 1);
  assert.ok(ev.sample_datapoint.trajectory_summary.turns > 0);
  assert.equal(ev.sample_datapoint.task.task_checksum, ev.scenarios[0].task_checksum);
});

test.after(() => rmSync(runsDir, { recursive: true, force: true }));
