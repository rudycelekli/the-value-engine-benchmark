// benchmark/src/env/harbor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { buildHarborPackage } from './harbor.js';

test('buildHarborPackage writes the full Harbor task anatomy', () => {
  const out = mkdtempSync(join(tmpdir(), 'veb-harbor-'));
  try {
    const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
    const written = buildHarborPackage({ scenario, outDir: out, generatedAt: '2026-07-08T00:00:00Z' });
    const root = join(out, scenario.id);
    for (const rel of ['instruction.md', 'task.toml', 'environment/Dockerfile', 'environment/task_file/scenario.yaml', 'tests/test.sh', 'solution/solve.sh', 'rubrics.txt']) {
      assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
    }
    assert.ok(written.length >= 7);
    // task.toml pins provenance + the checksum
    const toml = readFileSync(join(root, 'task.toml'), 'utf8');
    assert.match(toml, /task_checksum\s*=\s*"[0-9a-f]{64}"/);
    assert.match(toml, /buyer_sim\s*=\s*"claude-sonnet-4-6@t0\.8\+smv3"/);
    // Dockerfile is pinned
    assert.match(readFileSync(join(root, 'environment/Dockerfile'), 'utf8'), /FROM node:20\.\d+\.\d+-slim/);
    // shell scripts are executable so a Harbor runner can invoke them directly
    for (const rel of ['tests/test.sh', 'solution/solve.sh']) {
      assert.ok((statSync(join(root, rel)).mode & 0o100) !== 0, `${rel} not executable`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
