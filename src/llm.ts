/** Minimal LLM clients over fetch (Node 20+). No SDK dependency. */

import { AsyncLocalStorage } from 'node:async_hooks';
import { postJsonWithRetry } from './http-retry.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Portkey request metadata (observability join keys)
// ---------------------------------------------------------------------------
//
// Every request routes through Portkey with an `x-portkey-metadata` header. The
// org guardrail requires `engagement_name`; we ADD per-rollout join keys
// (model_spec, scenario, seed, track, row_id) so the Portkey analytics/logs API
// can slice latency, cost, tokens, cache and status by model AND by individual
// cell offline — without recording anything in the hot scoring path. The extra
// keys are inert to cost/billing; they exist purely so `analytics/groups/...`
// and `graphs/latency?metadata=...` can attribute every request to its cell.
//
// The context is set once per rollout (env/rollout.ts) and inherited by every
// seller/buyer/judge call underneath via AsyncLocalStorage. Absent a scope
// (e.g. offline panel re-grade, tests), only `engagement_name` is sent.

export type PortkeyMeta = Record<string, string | number | boolean>;

const metaScope = new AsyncLocalStorage<PortkeyMeta>();

/** Run `fn` with per-request Portkey metadata merged into every call it makes. */
export function withPortkeyMeta<T>(meta: PortkeyMeta, fn: () => Promise<T>): Promise<T> {
  return metaScope.run(meta, fn);
}

/** The `x-portkey-metadata` header value: engagement_name + any scoped join keys (all string-coerced). */
export function portkeyMetadataHeader(): string {
  const scoped = metaScope.getStore();
  const meta: Record<string, string> = {
    engagement_name: process.env.PORTKEY_ENGAGEMENT ?? 'value-engine-benchmark',
  };
  if (scoped) for (const [k, v] of Object.entries(scoped)) meta[k] = String(v);
  return JSON.stringify(meta);
}

/**
 * Anthropic routing: Portkey-only (policy 2026-07-03). All traffic goes
 * through the Portkey gateway's native /v1/messages endpoint (same
 * request/response shape, model prefixed with the integration slug). There is
 * no direct-provider fallback — the org guardrail + unified billing require it.
 */
export function anthropicEndpoint(model: string): {
  url: string;
  headers: Record<string, string>;
  model: string;
} {
  const portkeyKey = process.env.PORTKEY_API_KEY;
  if (!portkeyKey) throw new Error('PORTKEY_API_KEY not set (use --mock for offline mode)');
  return {
    url: 'https://api.portkey.ai/v1/messages',
    headers: {
      'x-portkey-api-key': portkeyKey,
      'x-portkey-metadata': portkeyMetadataHeader(),
    },
    model: model.startsWith('@') ? model : `@anthropic/${model}`,
  };
}

export async function anthropicChat(opts: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const endpoint = anthropicEndpoint(opts.model);
  // Route through the shared retry+timeout transport (5 attempts, jittered
  // backoff, 180s mid-stream-stall abort) — the SAME discipline the seller path
  // uses. This is the untracked path (no recordUsage): judge/buyer/vendor tokens
  // stay out of the rollout budget scope by design.
  const data = (await postJsonWithRetry('Anthropic', endpoint.url, endpoint.headers, {
    model: endpoint.model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    system: opts.system,
    messages: opts.messages,
  })) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

export async function openaiChat(opts: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  // Portkey-only routing (policy 2026-07-03): all providers via the gateway.
  const portkeyKey = process.env.PORTKEY_API_KEY;
  if (!portkeyKey) throw new Error('PORTKEY_API_KEY not set (use --mock for offline mode)');
  // Shared retry+timeout transport (untracked path — no recordUsage).
  const data = (await postJsonWithRetry(
    'OpenAI',
    'https://api.portkey.ai/v1/chat/completions',
    {
      'x-portkey-api-key': portkeyKey,
      'x-portkey-metadata': portkeyMetadataHeader(),
    },
    {
      model: opts.model.startsWith('@') ? opts.model : `@openai/${opts.model}`,
      max_completion_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    },
  )) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

/**
 * Extract the first JSON object from an LLM reply. Handles code fences,
 * trailing prose/extra objects after the JSON (balanced-scan for the end of
 * the FIRST object), and max_tokens-truncated output (repair).
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error(`No JSON object in LLM output: ${text.slice(0, 200)}`);

  // Balanced scan: find where the first object actually closes, so trailing
  // commentary or a second JSON object cannot corrupt the parse.
  const src = candidate.slice(start);
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        const balanced = src.slice(0, i + 1);
        try {
          return JSON.parse(balanced) as T;
        } catch {
          // Structurally balanced but malformed (missing comma, bad escape…):
          // progressively trim the tail back to the last parseable boundary.
          return JSON.parse(repairTruncatedJson(balanced)) as T;
        }
      }
    }
  }
  // Never closed — truncated mid-stream; repair.
  return JSON.parse(repairTruncatedJson(src)) as T;
}

/**
 * Extract EVERY top-level JSON object from a reply, in order. Used by the
 * buyer adapter so a model that emits a planning object followed by an action
 * object gets its ACTION counted, not just the first blob. Unparseable spans
 * are skipped; a final unclosed object goes through truncation repair.
 */
export function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    const src = text.slice(start);
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let j = 0; j < src.length; j++) {
      const ch = src[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      // Truncated tail — repair it, then stop.
      try {
        out.push(JSON.parse(repairTruncatedJson(src)));
      } catch {
        /* unrecoverable tail */
      }
      break;
    }
    try {
      out.push(JSON.parse(src.slice(0, end + 1)));
      i = start + end + 1;
    } catch {
      i = start + 1;
    }
  }
  return out;
}

/**
 * Repair JSON truncated mid-stream (e.g., by a max_tokens cut): rewind to the
 * last completed value boundary, drop any dangling comma/key, and close every
 * still-open object/array. Lossy at the tail by design — the harness's
 * citation sanitizers treat missing entries as unproven.
 */
export function repairTruncatedJson(src: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  // Every index just past a complete value, with the open-scope stack there.
  const safePoints: Array<{ end: number; stack: string[] }> = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        safePoints.push({ end: i + 1, stack: [...stack] });
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      safePoints.push({ end: i + 1, stack: [...stack] });
    } else if (/[\d]/.test(ch) || ch === 'e' || ch === 'l' /* true/false/null */) {
      // Treat the end of a primitive as safe only when followed by a delimiter
      // we can see; conservative — string/bracket boundaries carry the repair.
      const next = src[i + 1];
      if (next === ',' || next === '}' || next === ']' || next === '\n') {
        safePoints.push({ end: i + 1, stack: [...stack] });
      }
    }
  }
  if (safePoints.length === 0) throw new Error(`Unrepairable JSON in LLM output: ${src.slice(0, 200)}`);
  // Rewind through safe boundaries until a candidate actually parses. The
  // usual case is the LAST boundary (clean truncation); rewinding further
  // also recovers from a malformed tail (missing comma, bad escape) by
  // sacrificing entries after the damage. Lossy by design — the harness's
  // citation sanitizers treat missing entries as unproven.
  const MAX_REWIND = 64;
  let firstError: unknown;
  for (let k = safePoints.length - 1; k >= Math.max(0, safePoints.length - MAX_REWIND); k--) {
    const { end, stack: open } = safePoints[k];
    // Drop a dangling comma or an orphaned "key": with no value after it —
    // both mid-object (", "key"") and as an object's first key ("{"key"").
    const head = src
      .slice(0, end)
      .replace(/,\s*("(?:[^"\\]|\\.)*"\s*:?\s*)?$/, '')
      .replace(/([{[]\s*)"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1');
    const candidate = head + [...open].reverse().join('');
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (err) {
      firstError = firstError ?? err;
    }
  }
  throw new Error(`Unrepairable JSON in LLM output (${String(firstError)}): ${src.slice(0, 200)}`);
}
