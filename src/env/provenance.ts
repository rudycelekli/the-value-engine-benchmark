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

/**
 * Sentinel for "the git state could not be determined" — no repository, no git
 * binary, or a repository with no commits. It is NOT a synonym for clean: a row
 * carrying it names no code at all, which is strictly less provenance than a
 * row that at least names a dirty checkout. `assertCleanTreeForRelease` treats
 * it as release-ineligible for exactly that reason.
 */
export const UNKNOWN_SHA = 'unknown';

export function gitState(): { sha: string; dirty: boolean } {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!sha) return { sha: UNKNOWN_SHA, dirty: false };
    // Deliberately NOT wrapped in its own catch. If `git status` cannot answer,
    // the tree's state is unknown — not clean — so the failure must reach the
    // outer catch and surface as UNKNOWN_SHA. An inner catch that defaulted
    // dirty to false is precisely how indeterminate state got laundered into a
    // clean-looking provenance stamp.
    const dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: UNKNOWN_SHA, dirty: false };
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
 * Refuses to emit released rows unless the git state proves which code produced
 * them. Two states fail that test, and both are refused:
 *
 *   - dirty tree — every canonical-135 row carries `git.dirty = true`, because
 *     those rollouts were generated while the tree had uncommitted changes, so
 *     the recorded `git.sha` names the checkout the run started from rather than
 *     the code that produced the row. That freeze is not retroactively fixable;
 *     this gate is what stops it happening again.
 *   - indeterminate state (`UNKNOWN_SHA`) — run outside a repository, without a
 *     git binary, or before the first commit. The first version of this gate
 *     inspected only `dirty` and so let this case through: `gitState()` failed
 *     open to `{sha: 'unknown', dirty: false}`, which reads as clean and is not.
 *     Absence of evidence was being recorded as evidence of cleanliness.
 *
 * Kept pure (state passed in) so both refusal paths are testable without
 * dirtying a real tree or deleting one.
 *
 * `allowDirty` is a deliberate, loud override for local experimentation, not a
 * default. It covers both states, and in each case the row keeps the very field
 * that makes it unreleasable — `dirty: true` or `sha: "unknown"` — so an
 * override leaves the same trace in the data that it does on the console.
 */
export function assertCleanTreeForRelease(
  state: { sha: string; dirty: boolean },
  allowDirty = false,
  warn: (msg: string) => void = console.warn,
): void {
  const indeterminate = !state.sha || state.sha === UNKNOWN_SHA;
  if (!indeterminate && !state.dirty) return;

  const what = indeterminate
    ? 'an indeterminate git state (no repository, no git binary, or no commit yet)'
    : `a dirty tree (HEAD=${state.sha.slice(0, 12)})`;
  const why = indeterminate
    ? 'rows would record git.sha="unknown", naming no code at all'
    : 'git.sha would not identify the code that produced them';

  if (allowDirty) {
    warn(
      `⚠ emitting released rows from ${what} (--allow-dirty): ${why}. Do not release these rows.`,
    );
    return;
  }
  throw new Error(
    `refusing to emit released rows from ${what}: ${why}. ` +
      'Run from a clean checkout, or pass --allow-dirty to emit unreleasable rows anyway.',
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
