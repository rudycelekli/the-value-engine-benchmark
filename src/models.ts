/**
 * Frontier model registry for the suite runner.
 *
 * The default matrix is the top-2 models per provider. Edit the constants
 * below as the frontier moves — model IDs (especially OpenAI's) may need
 * updating over time; prices are $/Mtok list prices, 0 when unknown.
 */

export type Provider = 'anthropic' | 'openai' | 'xai' | 'gemini' | 'openrouter' | 'together';

export interface ModelEntry {
  provider: Provider;
  /** Provider-native model id (goes into the seller spec `provider:model`). */
  model: string;
  /** $ per 1M input tokens (0 if unknown — cost shows as 0). */
  inputPerMtok: number;
  /** $ per 1M output tokens (0 if unknown). */
  outputPerMtok: number;
}

/**
 * Top-2 per provider. NOTE: these IDs reflect the frontier as of writing and
 * may need updating (OpenAI in particular versions quickly).
 */
export const FRONTIER_MODELS: ModelEntry[] = [
  // Verified available via Portkey 2026-07-03; price carried over from opus-4-6 tier.
  { provider: 'anthropic', model: 'claude-opus-4-8', inputPerMtok: 15, outputPerMtok: 75 },
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPerMtok: 15, outputPerMtok: 75 },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPerMtok: 3, outputPerMtok: 15 },
  // Verified available via Portkey 2026-07-09. Price is a placeholder ESTIMATE
  // (opus flagship tier) until Anthropic publishes list prices — cost_usd for
  // this row is approximate.
  { provider: 'anthropic', model: 'claude-fable-5', inputPerMtok: 15, outputPerMtok: 75 },
  // Verified against the live /v1/models list on 2026-07-02. Prices are
  // estimates carried over from the prior flagship/mini tiers.
  // NOTE: gpt-5.5-pro is intentionally NOT on the roster (off-benchmark
  // experiment); leaving it out keeps `--sellers frontier` at 11 models.
  { provider: 'openai', model: 'gpt-5.5', inputPerMtok: 1.25, outputPerMtok: 10 },
  // Verified available via Portkey 2026-07-09 (routes on chat/completions). Price
  // is a placeholder ESTIMATE (carried from gpt-5.5 tier) until OpenAI publishes
  // list prices.
  { provider: 'openai', model: 'gpt-5.6-sol', inputPerMtok: 1.25, outputPerMtok: 10 },
  { provider: 'xai', model: 'grok-4.20-0309-reasoning', inputPerMtok: 3, outputPerMtok: 15 },
  { provider: 'xai', model: 'grok-4.3', inputPerMtok: 3, outputPerMtok: 15 },
  // Verified available via Portkey 2026-07-09. Price is a placeholder ESTIMATE
  // (carried from grok-4.3 tier) until xAI publishes list prices.
  { provider: 'xai', model: 'grok-4.5', inputPerMtok: 3, outputPerMtok: 15 },
  { provider: 'gemini', model: 'gemini-3.1-pro-preview', inputPerMtok: 2, outputPerMtok: 12 },
  { provider: 'gemini', model: 'gemini-3.5-flash', inputPerMtok: 0.3, outputPerMtok: 2.5 },
];

/**
 * Extra models added OUTSIDE the canonical-11 frontier roster (so `--sellers
 * frontier` stays at 11 for leaderboard continuity). Run these via explicit
 * specs, e.g. `--sellers openrouter:moonshotai/kimi-k3,together:thinkingmachines/inkling`.
 *
 * These two route DIRECTLY to their provider (not through Portkey) — the
 * workspace has no Portkey integration for OpenRouter/Together and Portkey has
 * no documented inline-key path. Cost is computed from our own token accounting
 * (priceForModel below), so Portkey consolidation is not needed.
 */
export const EXTRA_MODELS: ModelEntry[] = [
  // Kimi K3 (Moonshot) via OpenRouter. List price $3/$15 per Mtok (Moonshot official).
  { provider: 'openrouter', model: 'moonshotai/kimi-k3', inputPerMtok: 3, outputPerMtok: 15 },
  // Inkling (Thinking Machines) via Together AI serverless. Price is an ESTIMATE —
  // VERIFY against together.ai/models/inkling before quoting cost in the paper.
  { provider: 'together', model: 'thinkingmachines/inkling', inputPerMtok: 0.6, outputPerMtok: 0.6 },
];

/** Every known model (canonical frontier + extras) for pricing lookups. */
const ALL_MODELS: ModelEntry[] = [...FRONTIER_MODELS, ...EXTRA_MODELS];

/**
 * Env var holding the API key for each provider. Anthropic/OpenAI/xAI/Gemini
 * route through the Portkey gateway (policy 2026-07-03). OpenRouter/Together
 * use their own direct keys (see EXTRA_MODELS note).
 */
export const PROVIDER_ENV: Record<Provider, string> = {
  anthropic: 'PORTKEY_API_KEY',
  openai: 'PORTKEY_API_KEY',
  xai: 'PORTKEY_API_KEY',
  gemini: 'PORTKEY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
};

/** Provider of a seller spec, or undefined for scripted sellers. */
export function providerOfSpec(spec: string): Provider | undefined {
  const provider = spec.split(':')[0];
  return (['anthropic', 'openai', 'xai', 'gemini', 'openrouter', 'together'] as Provider[]).find((p) => p === provider);
}

/** Pricing for a model id (0/0 when not in the registry). */
export function priceForModel(model: string): { inputPerMtok: number; outputPerMtok: number } {
  const entry = ALL_MODELS.find((m) => m.model === model);
  return entry ? { inputPerMtok: entry.inputPerMtok, outputPerMtok: entry.outputPerMtok } : { inputPerMtok: 0, outputPerMtok: 0 };
}

/** Estimated $ cost for a usage map (model id → tokens). */
export function costOfUsage(usage: Map<string, { inputTokens: number; outputTokens: number }>): number {
  let total = 0;
  for (const [model, u] of usage) {
    const p = priceForModel(model);
    total += (u.inputTokens / 1_000_000) * p.inputPerMtok + (u.outputTokens / 1_000_000) * p.outputPerMtok;
  }
  return total;
}

/**
 * Resolve a `--sellers` spec into a list of concrete seller specs.
 *
 * Supports:
 *   - `frontier` → all 11 registry models as `provider:model`;
 *   - `provider:model` (anthropic/openai/xai/gemini);
 *   - `scripted-baseline` / `scripted-disciplined`;
 *   - comma-separated lists mixing any of the above.
 */
export function resolveSellers(spec: string): string[] {
  const out: string[] = [];
  for (const token of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (token === 'frontier') {
      out.push(...FRONTIER_MODELS.map((m) => `${m.provider}:${m.model}`));
    } else {
      out.push(token);
    }
  }
  return [...new Set(out)];
}
