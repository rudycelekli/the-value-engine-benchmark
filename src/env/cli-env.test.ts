// benchmark/src/env/cli-env.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Requires a prior `npm run build`. Runs the compiled CLI end-to-end in mock.
const CLI = join(process.cwd(), 'dist', 'cli.js');

test('env gate on the flagship prints PASS in mock', () => {
  const out = execFileSync('node', [CLI, 'env', 'gate', '--scenario', 'scenarios/01-logistics-saas.yaml'], { encoding: 'utf8' });
  assert.match(out, /PASS/);
});

test('env build writes a Harbor package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veb-cli-harbor-'));
  try {
    execFileSync('node', [CLI, 'env', 'build', '--scenario', 'scenarios/01-logistics-saas.yaml', '--out', dir], { encoding: 'utf8' });
    assert.ok(existsSync(join(dir, 'logistics-saas', 'task.toml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env dataset writes a reward-diverse RLVR JSONL + card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veb-cli-dataset-'));
  try {
    const out = execFileSync('node', [CLI, 'env', 'dataset', '--scenario', 'scenarios/01-logistics-saas.yaml', '--out', dir], { encoding: 'utf8' });
    assert.match(out, /RLVR dataset/);
    assert.match(out, /7 rollouts/);
    assert.ok(existsSync(join(dir, 'dataset.jsonl')));
    assert.ok(existsSync(join(dir, 'dataset.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env rollout (mock) writes dataset.jsonl and rollout-report.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veb-cli-rollout-'));
  try {
    execFileSync(
      'node',
      [
        CLI,
        'env',
        'rollout',
        '--scenarios',
        'scenarios/01-logistics-saas.yaml',
        '--sellers',
        'scripted-disciplined,scripted-baseline',
        '--seeds',
        '2',
        '--budget',
        '100',
        '--out',
        dir,
        '--mock',
      ],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(readFileSync(join(dir, 'rollout-report.json'), 'utf8'));
    assert.equal(report.datapoints, 4); // 1 env × 2 sellers × 2 seeds
    const lines = readFileSync(join(dir, 'dataset.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env verify record→replay freezes and reproduces the buyer through the CLI', () => {
  const tdir = mkdtempSync(join(tmpdir(), 'veb-cli-transcript-'));
  const args = ['env', 'verify', '--scenario', 'scenarios/01-logistics-saas.yaml', '--mock', '--transcript-dir', tdir];
  try {
    const rec = execFileSync('node', [CLI, ...args, '--buyer-mode', 'record'], { encoding: 'utf8' });
    assert.match(rec, /buyer=record/);
    assert.ok(existsSync(join(tdir, 'buyer-transcript.json')));
    const recReward = /reward=([0-9.]+)/.exec(rec)?.[1];

    const rep = execFileSync('node', [CLI, ...args, '--buyer-mode', 'replay'], { encoding: 'utf8' });
    assert.match(rep, /buyer=replay/);
    const repReward = /reward=([0-9.]+)/.exec(rep)?.[1];
    assert.equal(repReward, recReward);
  } finally {
    rmSync(tdir, { recursive: true, force: true });
  }
});
