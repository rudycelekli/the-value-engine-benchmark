/**
 * CTRF (Common Test Report Format) view of a reward: one "test" per
 * deterministic milestone, so the environment plugs into any CTRF-aware
 * harness — ctrf.json is emitted alongside reward.txt, as Terminal-Bench-style
 * tasks do.
 */
import type { RewardBreakdown } from './reward.js';

export interface CtrfReport {
  results: {
    tool: { name: string };
    summary: { tests: number; passed: number; failed: number; start: number; stop: number };
    tests: Array<{ name: string; status: 'passed' | 'failed'; duration: number; message?: string }>;
  };
}

export function buildCtrf(rb: RewardBreakdown, generatedAtMs: number): CtrfReport {
  const tests = rb.milestones.map((m) => ({
    name: m.id,
    status: (m.met ? 'passed' : 'failed') as 'passed' | 'failed',
    duration: 0,
    message: `${m.label}: ${m.detail} (score ${m.score})`,
  }));
  const passed = tests.filter((t) => t.status === 'passed').length;
  return {
    results: {
      tool: { name: 'veb-env' },
      summary: { tests: tests.length, passed, failed: tests.length - passed, start: generatedAtMs, stop: generatedAtMs },
      tests,
    },
  };
}
