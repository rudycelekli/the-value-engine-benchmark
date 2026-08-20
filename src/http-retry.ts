/**
 * Shared retrying JSON-POST transport for ALL Portkey/LLM traffic.
 *
 * Extracted verbatim from seller/providers.ts (where it hardened the seller +
 * offline judge panel) so the UNTRACKED live-judge/buyer/vendor path in llm.ts
 * can reuse the exact same discipline instead of a naked single `fetch`. One
 * implementation, one behaviour:
 *   - 5 attempts, exponential backoff + jitter on 429/5xx/network/abort;
 *   - a single 180s AbortController guarding the WHOLE attempt (connect,
 *     headers, AND body read) so a mid-stream Portkey/Cloudflare zombie socket
 *     becomes a retryable AbortError instead of an infinite await;
 *   - non-429 4xx are thrown immediately (`__noRetry`), not retried.
 *
 * This module is transport-only: no usage recording, no budget accounting. The
 * tracked seller wrapper (providers.ts) layers `recordUsage` on top; the
 * untracked wrapper (llm.ts) calls this directly, preserving the "judge tokens
 * out of budget scope" invariant.
 */

export const MAX_ATTEMPTS = 5;
// Abort a request whose socket goes silent (Portkey/Cloudflare "zombie
// connection": headers/partial body arrive, then the stream freezes with 0
// bytes and idle CPU). Without this, `fetch`/`res.json()` await forever and the
// whole episode wedges. The timeout converts the hang into an AbortError that
// the retry loop below already treats as a transient, retryable fault. Generous
// enough (3 min) not to clip legitimately slow reasoning calls (gpt-5.x thinking).
export const REQUEST_TIMEOUT_MS = 180_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function postJsonWithRetry(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    // One timer guards the ENTIRE attempt — connect, headers, AND body read —
    // because the stall was observed mid-stream (partial body, then silence).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (res.ok) return await res.json(); // awaited inside try so a body-stream stall aborts here too
      const text = await res.text().catch(() => '');
      const error = new Error(`${label} API ${res.status}: ${text.slice(0, 400)}`);
      if (res.status === 429 || res.status >= 500) {
        lastError = error; // retryable
        continue;
      }
      throw Object.assign(error, { __noRetry: true }); // 4xx other than 429 — do not retry
    } catch (err) {
      if ((err as { __noRetry?: boolean }).__noRetry) throw err;
      lastError = err as Error; // network error, timeout abort, or mid-stream stall — retryable
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} API failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`);
}
