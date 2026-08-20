/**
 * Usage-aware, retrying LLM chat clients for the SELLER adapters.
 *
 * Raw fetch, no SDKs (mirrors src/llm.ts style). Every call:
 *   - retries with exponential backoff on 429/5xx/network errors (3 tries);
 *   - records token usage (per model, globally AND per async scope) so the
 *     suite runner can compute cost per episode even under concurrency.
 *
 * Providers: Anthropic, OpenAI, xAI Grok (OpenAI-compatible), Google Gemini.
 *
 * ALL traffic routes through the Portkey gateway (policy since 2026-07-03):
 * unified cost tracking, credits, and guardrails. Models are addressed with
 * Portkey integration slugs (@openai/…, @xai/…, @gemini/…, @anthropic/…).
 * The x-portkey-metadata engagement header is REQUIRED — the org guardrail
 * blocks requests without it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { anthropicEndpoint, portkeyMetadataHeader, type ChatMessage } from '../llm.js';
import { postJsonWithRetry } from '../http-retry.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatOpts {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

/** Per-model usage map: model id → cumulative tokens. */
export type UsageMap = Map<string, TokenUsage>;

const globalUsage: UsageMap = new Map();
const usageScope = new AsyncLocalStorage<UsageMap>();

function addUsage(map: UsageMap, model: string, u: TokenUsage): void {
  const cur = map.get(model) ?? { inputTokens: 0, outputTokens: 0 };
  cur.inputTokens += u.inputTokens;
  cur.outputTokens += u.outputTokens;
  map.set(model, cur);
}

export function recordUsage(model: string, u: TokenUsage): void {
  addUsage(globalUsage, model, u);
  const scoped = usageScope.getStore();
  if (scoped) addUsage(scoped, model, u);
}

/** Run `fn` with a fresh usage scope; returns the result plus that scope's usage. */
export async function withUsageScope<T>(fn: () => Promise<T>): Promise<{ result: T; usage: UsageMap }> {
  const usage: UsageMap = new Map();
  const result = await usageScope.run(usage, fn);
  return { result, usage };
}

/** Cumulative process-wide usage per model (cloned). */
export function usageTotals(): UsageMap {
  return new Map([...globalUsage.entries()].map(([m, u]) => [m, { ...u }]));
}

// ---------------------------------------------------------------------------
// Retry helper — shared transport in ../http-retry.ts (postJsonWithRetry).
// The seller path layers recordUsage on top; the untracked llm.ts path calls
// the same helper directly. Kept as ONE implementation to avoid divergence.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (use --mock / a different --sellers spec)`);
  return v;
}

// ---------------------------------------------------------------------------
// Portkey gateway (all providers)
// ---------------------------------------------------------------------------

const PORTKEY_BASE = 'https://api.portkey.ai/v1';

function portkeyHeaders(): Record<string, string> {
  return {
    'x-portkey-api-key': requireEnv('PORTKEY_API_KEY'),
    'x-portkey-metadata': portkeyMetadataHeader(),
  };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

// Newer Claude models (claude-fable-5, opus-4-8+) reject `temperature` outright
// with a 400. Without memoization every turn pays that failed round-trip before
// the retry-without-temperature — doubling API calls on the slowest, most
// throttled arms (fable especially). Remember the rejection per resolved model
// so each one 400s at most ONCE per process, then omits temperature upfront.
const temperatureRejecters = new Set<string>();

export async function anthropicChatTracked(opts: ChatOpts): Promise<string> {
  const endpoint = anthropicEndpoint(opts.model);
  const body: Record<string, unknown> = {
    model: endpoint.model,
    // Same generous headroom as the OpenAI-compat path (openaiCompatChat). A
    // tight cap silently truncates the action mid-`content` — the JSON-repair
    // then salvages a content-less skeleton ({"type":..,"to":..}) that coerces
    // to a wasted note, with NO format-retry logged. 800 was clipping ~16-72%
    // of Anthropic actions; 8192 gives every seller the same room to act.
    max_tokens: Math.max(opts.maxTokens ?? 1024, 8192),
    system: opts.system,
    messages: opts.messages,
  };
  if (!temperatureRejecters.has(endpoint.model)) body.temperature = opts.temperature ?? 0.7;
  let raw: unknown;
  try {
    raw = await postJsonWithRetry('Anthropic', endpoint.url, endpoint.headers, body);
  } catch (err) {
    // First time this model rejects `temperature`: strip it, remember, retry.
    if (/temperature.+deprecated/i.test((err as Error).message)) {
      temperatureRejecters.add(endpoint.model);
      delete body.temperature;
      raw = await postJsonWithRetry('Anthropic', endpoint.url, endpoint.headers, body);
    } else {
      throw err;
    }
  }
  const data = raw as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  recordUsage(opts.model, {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  });
  return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat/completions (OpenAI + xAI Grok)
// ---------------------------------------------------------------------------

interface OpenAICompatResponse {
  choices: Array<{ message: { content: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function openaiCompatChat(
  label: string,
  slug: string,
  opts: ChatOpts,
  { omitTemperature = false }: { omitTemperature?: boolean } = {},
): Promise<string> {
  const data = (await postJsonWithRetry(label, `${PORTKEY_BASE}/chat/completions`, portkeyHeaders(), {
    model: `@${slug}/${opts.model}`,
    // Reasoning-capable chat models (gpt-5.x, gemini thinking, grok reasoning)
    // count reasoning tokens against max_completion_tokens. A tight cap makes
    // them burn the whole budget thinking and return EMPTY content — which the
    // harness then logs as "No JSON object in LLM output". Same generous
    // headroom as the Responses path (see openaiResponsesChat).
    max_completion_tokens: Math.max(opts.maxTokens ?? 1024, 8192),
    // gpt-5.x chat models reject any temperature other than the default (1).
    ...(omitTemperature ? {} : { temperature: opts.temperature ?? 0.7 }),
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
  })) as OpenAICompatResponse;
  recordUsage(opts.model, {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  });
  const content = data.choices[0]?.message?.content ?? '';
  if (process.env.VEB_SELLER_DEBUG) {
    const fr = data.choices[0]?.finish_reason ?? '?';
    const ct = data.usage?.completion_tokens ?? 0;
    console.error(
      `\n[seller raw ${opts.model}] finish=${fr} completion_tokens=${ct} content_len=${content.length} has_brace=${content.includes('{')}\n` +
        `  HEAD: ${JSON.stringify(content.slice(0, 240))}\n` +
        `  TAIL: ${JSON.stringify(content.slice(-160))}\n`,
    );
  }
  return content;
}

/**
 * OpenAI Responses API — required for reasoning-only models (e.g. gpt-5.5-pro)
 * that are not served on /v1/chat/completions. Reasoning tokens count toward
 * max_output_tokens, so we give generous headroom to avoid empty replies.
 */
async function openaiResponsesChat(opts: ChatOpts): Promise<string> {
  const data = (await postJsonWithRetry(
    'OpenAI',
    `${PORTKEY_BASE}/responses`,
    portkeyHeaders(),
    {
      model: `@openai/${opts.model}`,
      max_output_tokens: Math.max(opts.maxTokens ?? 1024, 8192),
      input: [{ role: 'system', content: opts.system }, ...opts.messages],
    },
  )) as {
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  recordUsage(opts.model, {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  });
  return (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
}

/** Reasoning-only models that are not available on /v1/chat/completions. */
function needsResponsesApi(model: string): boolean {
  return /-pro\b/.test(model);
}

export async function openaiChatTracked(opts: ChatOpts): Promise<string> {
  if (needsResponsesApi(opts.model)) return openaiResponsesChat(opts);
  return openaiCompatChat('OpenAI', 'openai', opts, {
    omitTemperature: opts.model.startsWith('gpt-5'),
  });
}

export async function xaiChat(opts: ChatOpts): Promise<string> {
  return openaiCompatChat('xAI', 'xai', opts);
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

export async function geminiChat(opts: ChatOpts): Promise<string> {
  // Portkey's OpenAI-compatible surface translates to the Gemini API server-side.
  return openaiCompatChat('Gemini', 'gemini', opts);
}

// ---------------------------------------------------------------------------
// Direct OpenAI-compatible providers (NOT via Portkey)
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible chat against a provider's own base URL with a raw bearer
 * key. Used for Together (Inkling), which has no Portkey integration in this
 * workspace. `opts.model` is the provider-native slug verbatim (e.g.
 * `thinkingmachines/inkling`). (Kimi K3 now routes via Portkey's `@openrouter`
 * integration — see openrouterChat.)
 */
async function openaiCompatDirect(
  label: string,
  baseUrl: string,
  apiKeyEnv: string,
  opts: ChatOpts,
): Promise<string> {
  const data = (await postJsonWithRetry(label, `${baseUrl}/chat/completions`, {
    Authorization: `Bearer ${requireEnv(apiKeyEnv)}`,
  }, {
    model: opts.model,
    // Reasoning-capable models (Kimi K3 always-on thinking; Inkling controllable
    // thinking effort) count reasoning tokens against max_tokens. Same generous
    // 8192 floor as the Portkey reasoning paths, so a tight cap can't make them
    // burn the budget thinking and return empty content.
    max_tokens: Math.max(opts.maxTokens ?? 1024, 8192),
    temperature: opts.temperature ?? 0.7,
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
  })) as OpenAICompatResponse;
  recordUsage(opts.model, {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  });
  return data.choices[0]?.message?.content ?? '';
}

/**
 * Kimi K3 (Moonshot) via OpenRouter, routed through the Portkey `@openrouter`
 * integration (model spec `@openrouter/moonshotai/kimi-k3`). The direct
 * OpenRouter surface is unused: the workspace's personal OPENROUTER_API_KEY is
 * dead ($0 credit / 401), whereas the org's Portkey `@openrouter` integration
 * is funded (is_byok:false) and bills the org — same pattern as Anthropic.
 *
 * Kimi K3's high format-retry rate is NOT a token-budget problem (verified via
 * VEB_SELLER_DEBUG: failing turns are finish=stop at ~1k completion tokens, well
 * under the 8192 floor). It drops the JSON contract and emits tagged prose that
 * echoes the transcript's `[wk# kind persona]` labels — fixed in the seller
 * layer via OpenRouterSeller.extraContract(), not here.
 */
export async function openrouterChat(opts: ChatOpts): Promise<string> {
  return openaiCompatChat('OpenRouter', 'openrouter', opts);
}

/** Inkling (Thinking Machines) via Together AI — model id `thinkingmachines/inkling`. */
export async function togetherChat(opts: ChatOpts): Promise<string> {
  return openaiCompatDirect('Together', 'https://api.together.xyz/v1', 'TOGETHER_API_KEY', opts);
}
