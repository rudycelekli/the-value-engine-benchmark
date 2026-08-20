/**
 * Writes the standard verifier artifacts into a logs dir:
 *   reward.txt   — the scalar reward (primary signal the harness reads)
 *   ctrf.json    — per-milestone pass/fail
 *   result.json  — full breakdown + provenance (seed, buyer-sim, task_checksum)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CtrfReport } from './ctrf.js';
import type { RewardBreakdown } from './reward.js';
import type { EnvProvenance } from './provenance.js';

export interface EnvResult {
  scenarioId: string;
  sellerId: string;
  reward: number;
  resolved: boolean;
  provenance: EnvProvenance;
  breakdown: RewardBreakdown;
}

export interface VerifierArtifacts {
  reward: number;
  ctrf: CtrfReport;
  result: EnvResult;
}

export function writeVerifierArtifacts(dir: string, result: EnvResult, ctrf: CtrfReport): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reward.txt'), `${result.reward}\n`, 'utf8');
  writeFileSync(join(dir, 'ctrf.json'), `${JSON.stringify(ctrf, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
