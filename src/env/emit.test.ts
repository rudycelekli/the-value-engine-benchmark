// benchmark/src/env/emit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCtrf } from './ctrf.js';
import { writeVerifierArtifacts, type EnvResult } from './emit.js';
import type { RewardBreakdown } from './reward.js';

const rb: RewardBreakdown = {
  reward: 0.94, resolved: true, milestonePartial: 1, rubricNorm: 0.85, vetoed: false, criticalFailures: [],
  milestones: [
    { id: 'facts', label: 'Required facts earned', met: true, score: 1, weight: 0.4, detail: '4/4' },
    { id: 'trust', label: 'Trust threshold', met: true, score: 1, weight: 0.2, detail: 'trust 70/60' },
    { id: 'eb', label: 'Economic-buyer meeting', met: false, score: 0, weight: 0.15, detail: 'EB never met' },
    { id: 'map', label: 'Mutual action plan', met: true, score: 1, weight: 0.15, detail: 'MAP acknowledged' },
    { id: 'price', label: 'Price integrity', met: true, score: 1, weight: 0.1, detail: 'discount 0% vs 10%' },
  ],
};

test('buildCtrf maps one test per milestone with correct pass/fail counts', () => {
  const c = buildCtrf(rb, 1_000);
  assert.equal(c.results.summary.tests, 5);
  assert.equal(c.results.summary.passed, 4);
  assert.equal(c.results.summary.failed, 1);
  assert.equal(c.results.tests.find((t) => t.name === 'eb')!.status, 'failed');
});

test('writeVerifierArtifacts writes reward.txt, ctrf.json, result.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veb-env-'));
  try {
    const result: EnvResult = {
      scenarioId: 'logistics-saas', sellerId: 'oracle', reward: 0.94, resolved: true,
      provenance: { generatedAt: '2026-07-08T00:00:00Z', git: { sha: 'abc', dirty: false }, buyerSim: 'claude-sonnet-4-6@t0.8+smv3', seed: 42, taskChecksum: 'deadbeef' },
      breakdown: rb,
    };
    writeVerifierArtifacts(dir, result, buildCtrf(rb, 1_000));
    assert.equal(readFileSync(join(dir, 'reward.txt'), 'utf8').trim(), '0.94');
    const ctrf = JSON.parse(readFileSync(join(dir, 'ctrf.json'), 'utf8'));
    assert.equal(ctrf.results.summary.tests, 5);
    const res = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    assert.equal(res.provenance.taskChecksum, 'deadbeef');
    assert.equal(res.reward, 0.94);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
