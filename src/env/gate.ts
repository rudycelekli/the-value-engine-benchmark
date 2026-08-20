/**
 * Difficulty-band gate: an environment ships only if the disciplined oracle
 * can solve it (reward >= ORACLE_MIN) AND the naive baseline cannot
 * (reward < FLOOR_MAX). Reuses the same two scripted sellers `calibrate`
 * uses. In mock this proves solvability + non-triviality; Phase 2 swaps in
 * real frontier rollouts to enforce the partial-pass band.
 */
import type { Scenario } from '../types.js';
import { verifyScenario } from './verifier.js';

export const ORACLE_MIN = 0.9;
export const FLOOR_MAX = 0.5;

export interface GateReport {
  scenarioId: string;
  oracleReward: number;
  floorReward: number;
  oraclePass: boolean;
  floorPass: boolean;
  pass: boolean;
}

export async function runDifficultyGate(scenario: Scenario, runsDir: string): Promise<GateReport> {
  const oracle = await verifyScenario({ scenario, sellerSpec: 'scripted-disciplined', pack: false, mock: true, runsDir });
  const floor = await verifyScenario({ scenario, sellerSpec: 'scripted-baseline', pack: false, mock: true, runsDir });
  const oracleReward = oracle.result.reward;
  const floorReward = floor.result.reward;
  const oraclePass = oracleReward >= ORACLE_MIN;
  const floorPass = floorReward < FLOOR_MAX;
  return {
    scenarioId: scenario.id,
    oracleReward,
    floorReward,
    oraclePass,
    floorPass,
    pass: oraclePass && floorPass,
  };
}
