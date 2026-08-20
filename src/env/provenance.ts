/**
 * Phase-0 environment tax: the reproducibility header stamped onto every
 * emitted environment. Mirrors src/dataset/provenance.ts (git + sha256)
 * but keyed to a single scenario: it pins the seed, the frozen buyer-sim
 * version, and an sha256 task_checksum of the exact scenario world.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Scenario } from '../types.js';
import { buyerSimVersion } from './buyer-sim.js';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Canonical bytes of the scenario world → sha256. Stable key ordering via JSON.stringify of the parsed object. */
export function taskChecksum(scenario: Scenario): string {
  return sha256(JSON.stringify(scenario));
}

export function gitState(): { sha: string; dirty: boolean } {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let dirty = false;
    try {
      dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    } catch {
      dirty = false;
    }
    return { sha: sha || 'unknown', dirty };
  } catch {
    return { sha: 'unknown', dirty: false };
  }
}

export interface EnvProvenance {
  generatedAt: string;
  git: { sha: string; dirty: boolean };
  buyerSim: string;
  seed: number | null;
  taskChecksum: string;
}

/**
 * Refuses to emit released rows from a dirty working tree.
 *
 * Every canonical-135 row carries `git.dirty = true`: those rollouts were
 * generated while the tree had uncommitted changes, so the recorded `git.sha`
 * names the checkout the run started from rather than the code that produced
 * the row. That freeze is not retroactively fixable — this gate is what stops
 * it happening again. Kept pure (state passed in) so the failure path is
 * testable without dirtying a real tree.
 *
 * `allowDirty` is a deliberate, loud override for local experimentation, not a
 * default: rows emitted under it still record `dirty: true`, so an override
 * leaves the same trace in the data that it does on the console.
 */
export function assertCleanTreeForRelease(
  state: { sha: string; dirty: boolean },
  allowDirty = false,
  warn: (msg: string) => void = console.warn,
): void {
  if (!state.dirty) return;
  if (allowDirty) {
    warn(
      `⚠ emitting from a DIRTY tree at ${state.sha.slice(0, 12)} (--allow-dirty). ` +
        'Rows will record git.dirty=true and their git.sha will not identify the code that produced them. ' +
        'Do not release these rows.',
    );
    return;
  }
  throw new Error(
    `refusing to emit released rows from a dirty tree (HEAD=${state.sha.slice(0, 12)}): ` +
      'git.sha would not identify the code that produced them. ' +
      'Commit or stash your changes, or pass --allow-dirty to emit unreleasable rows anyway.',
  );
}

export function buildEnvProvenance(scenario: Scenario, generatedAt: string): EnvProvenance {
  return {
    generatedAt,
    git: gitState(),
    buyerSim: buyerSimVersion(),
    seed: scenario.generation?.seed ?? null,
    taskChecksum: taskChecksum(scenario),
  };
}
