/**
 * Ensemble "best-of-best" routing (pure, no LLM, no I/O).
 *
 * Segments a negotiation into phases from per-turn state and maps each phase to
 * the frontier model empirically strongest at the SQS component that phase
 * drives. Consumed by EnsembleSeller (src/seller/index.ts), which delegates the
 * turn to the routed model via createSeller. Kept pure so it is fully unit-
 * tested without touching providers or the network.
 */

import type { SellerView } from './index.js';
import type { Turn } from '../types.js';

export type Phase = 'prospecting' | 'discovery' | 'access' | 'eb_value' | 'close';

/** Narrow pricing/closing keyword scan over the last few transcript turns. */
const PRICING_RE = /\b(pric(e|ing)|discount|quote|proposal|percent off)\b|\$|\d+\s?%/i;

function pricingMentioned(transcript: Turn[]): boolean {
  return transcript.slice(-6).some((t) => PRICING_RE.test(t.content));
}

/**
 * Precedence cascade (exactly one phase):
 *   1. prospecting — no personas discovered yet
 *   2. close       — pricing is live OR we are in the final ~2 weeks
 *   3. eb_value    — the Economic Buyer is known
 *   4. discovery   — a call is open (and EB not yet known)
 *   5. access      — otherwise (nurture / champion-building between meetings)
 */
export function detectPhase(view: SellerView): Phase {
  if (view.knownPersonas.length === 0) return 'prospecting';
  const nearEnd = view.totalWeeks > 0 && view.week >= view.totalWeeks - 1;
  if (nearEnd || pricingMentioned(view.transcript)) return 'close';
  if (view.knownPersonas.some((p) => p.isEconomicBuyer)) return 'eb_value';
  if (view.openCall) return 'discovery';
  return 'access';
}

/**
 * Phase → provider:model assignment.
 *
 * PROVISIONAL defaults from the current aggregate leaderboard: gpt-5.6-sol leads
 * both DVI and win-conversion, so it backs every discovery/value phase;
 * claude-fable-5 is the price-integrity leader (0.81 vs 0.75), so it plays the
 * close. FINALIZE these from the frozen-grid per-phase attribution before the
 * ensemble run (see spec §4.2 / §8). Every value must be a spec createSeller can
 * resolve.
 */
export const PHASE_MODEL_MAP: Record<Phase, string> = {
  prospecting: 'openai:gpt-5.6-sol',
  discovery: 'openai:gpt-5.6-sol',
  access: 'openai:gpt-5.6-sol',
  eb_value: 'openai:gpt-5.6-sol',
  close: 'anthropic:claude-fable-5',
};

/** The model spec to play the current turn. */
export function routeModel(view: SellerView): string {
  return PHASE_MODEL_MAP[detectPhase(view)];
}
