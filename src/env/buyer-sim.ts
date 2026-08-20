/**
 * Phase-0 "environment tax": a single, honest descriptor of the buyer
 * simulator so every emitted environment records exactly which frozen
 * buyer it was verified against. Reads the SAME env defaults the live
 * buyer uses (src/buyer/index.ts: BENCH_BUYER_MODEL, temperature 0.8),
 * so what we STAMP is what actually RAN.
 */

/** Bump when BuyerStateMachine gating/reward semantics change (invalidates prior provenance). */
export const STATE_MACHINE_VERSION = 'v3';

/** The buyer prose model actually used by src/buyer/index.ts. */
const DEFAULT_BUYER_MODEL = 'claude-sonnet-4-6';
/** The temperature src/buyer/index.ts passes to anthropicChat for buyer prose. */
const BUYER_TEMPERATURE = 0.8;

export interface BuyerSimDescriptor {
  model: string;
  temperature: number;
  stateMachineVersion: string;
}

export function buyerSim(): BuyerSimDescriptor {
  return {
    model: process.env.BENCH_BUYER_MODEL ?? DEFAULT_BUYER_MODEL,
    temperature: BUYER_TEMPERATURE,
    stateMachineVersion: STATE_MACHINE_VERSION,
  };
}

/** Compact, filename/log-safe version string, e.g. "claude-sonnet-4-6@t0.8+smv3". */
export function buyerSimVersion(): string {
  const d = buyerSim();
  return `${d.model}@t${d.temperature}+sm${d.stateMachineVersion}`;
}
