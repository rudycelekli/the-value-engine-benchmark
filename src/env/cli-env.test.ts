// benchmark/src/env/cli-env.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
    // --allow-dirty: the row-emitting commands refuse to run from a dirty tree,
    // and a developer's tree is dirty exactly when they are running the tests.
    // These rows go to a temp dir and are never released.
    const out = execFileSync('node', [CLI, 'env', 'dataset', '--scenario', 'scenarios/01-logistics-saas.yaml', '--out', dir, '--allow-dirty'], { encoding: 'utf8' });
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
        '--allow-dirty',
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

test('env dataset refuses to emit from a dirty tree', () => {
  // Run the CLI with its cwd inside a throwaway repo that has a commit and an
  // uncommitted file, so `git status --porcelain` is non-empty regardless of
  // whether the tree this suite runs in happens to be clean.
  const repo = mkdtempSync(join(tmpdir(), 'veb-dirty-repo-'));
  try {
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    };
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(repo, 'uncommitted.txt'), 'dirty\n');

    const scenario = join(process.cwd(), 'scenarios', '01-logistics-saas.yaml');
    const { failed, stderr } = runCli(['env', 'dataset', '--scenario', scenario, '--out', join(repo, 'out')], repo);
    assert.ok(failed, 'env dataset should exit non-zero from a dirty tree');
    assert.match(stderr, /refusing to emit released rows from a dirty tree/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

/** Runs the CLI with `cwd` and returns { failed, stderr } instead of throwing. */
function runCli(args: string[], cwd: string): { failed: boolean; stderr: string } {
  try {
    execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, stderr: '' };
  } catch (err) {
    return { failed: true, stderr: String((err as { stderr?: string }).stderr ?? '') };
  }
}

// A bare temp dir is not a git repository, so `git rev-parse HEAD` fails and
// gitState() falls back to {sha: 'unknown', dirty: false} — the fail-open case
// that once emitted release rows naming no code at all. Both row-emitting
// commands must refuse it.
for (const [name, args] of [
  ['env dataset', ['env', 'dataset', '--scenario', 'SCENARIO', '--out', 'OUT']],
  [
    'env rollout',
    ['env', 'rollout', '--scenarios', 'SCENARIO', '--sellers', 'scripted-disciplined',
     '--seeds', '1', '--budget', '10', '--out', 'OUT', '--mock'],
  ],
] as const) {
  test(`${name} refuses to emit outside a git repository`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'veb-no-repo-'));
    try {
      const scenario = join(process.cwd(), 'scenarios', '01-logistics-saas.yaml');
      const concrete = args.map((a) => (a === 'SCENARIO' ? scenario : a === 'OUT' ? join(dir, 'out') : a));
      const { failed, stderr } = runCli(concrete, dir);
      assert.ok(failed, `${name} should exit non-zero outside a repository`);
      assert.match(stderr, /refusing to emit released rows/);
      assert.match(stderr, /indeterminate git state/);
      assert.ok(!existsSync(join(dir, 'out', 'dataset.jsonl')), 'no rows may be written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

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
