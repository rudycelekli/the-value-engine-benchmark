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

function gitState(): { sha: string; dirty: boolean } {
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

export function buildEnvProvenance(scenario: Scenario, generatedAt: string): EnvProvenance {
  return {
    generatedAt,
    git: gitState(),
    buyerSim: buyerSimVersion(),
    seed: scenario.generation?.seed ?? null,
    taskChecksum: taskChecksum(scenario),
  };
}
