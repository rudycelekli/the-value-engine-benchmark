/**
 * Judge provider routing for the multi-judge panel.
 *
 * The live harness grades every episode with a single Anthropic judge
 * (BENCH_JUDGE_MODEL). For the frozen paper grid we re-grade OFFLINE with a
 * 4-seat panel — the strongest grader from each model family — and aggregate by
 * median so no single family's house style sets the score. This module is the
 * thin routing layer: a JudgeSpec ("provider:model") → the matching Portkey chat
 * client (all usage-tracked, so panel cost lands in the same ledger as generation).
 */

import type { ChatMessage } from '../llm.js';
import { anthropicChatTracked, openaiChatTracked, xaiChat, geminiChat, type ChatOpts } from '../seller/providers.js';

export type JudgeProvider = 'anthropic' | 'openai' | 'gemini' | 'xai';

export interface JudgeSpec {
  provider: JudgeProvider;
  model: string;
}

/** Stable id for a judge seat, e.g. "openai:gpt-5.6-sol". Used as the per-judge map key. */
export function judgeId(spec: JudgeSpec): string {
  return `${spec.provider}:${spec.model}`;
}

/** Parse "provider:model". Throws on an unknown provider so a typo can't silently misroute. */
export function parseJudgeSpec(s: string): JudgeSpec {
  const i = s.indexOf(':');
  if (i === -1) throw new Error(`Judge spec must be "provider:model", got: ${s}`);
  const provider = s.slice(0, i) as JudgeProvider;
  const model = s.slice(i + 1);
  if (!['anthropic', 'openai', 'gemini', 'xai'].includes(provider)) {
    throw new Error(`Unknown judge provider "${provider}" in spec: ${s}`);
  }
  if (!model) throw new Error(`Empty model in judge spec: ${s}`);
  return { provider, model };
}

/** Route a grading call to the provider's Portkey client. Temperature is forced to 0 by the caller. */
export function judgeChat(spec: JudgeSpec, opts: Omit<ChatOpts, 'model'>): Promise<string> {
  const full: ChatOpts = { model: spec.model, ...opts };
  switch (spec.provider) {
    case 'anthropic':
      return anthropicChatTracked(full);
    case 'openai':
      return openaiChatTracked(full);
    case 'gemini':
      return geminiChat(full);
    case 'xai':
      return xaiChat(full);
  }
}

/** The live single-judge default (unchanged behaviour when the panel is not used). */
export const DEFAULT_JUDGE: JudgeSpec = parseJudgeSpec(
  process.env.BENCH_JUDGE_MODEL
    ? (process.env.BENCH_JUDGE_MODEL.includes(':') ? process.env.BENCH_JUDGE_MODEL : `anthropic:${process.env.BENCH_JUDGE_MODEL}`)
    : 'anthropic:claude-sonnet-4-6',
);

/**
 * The 4-seat offline panel: strongest grader per family, xAI seat = reasoning
 * variant. Median aggregation across these four is the frozen-grid score.
 * Override with BENCH_PANEL="p1:m1,p2:m2,..." for ablations.
 */
export const PANEL: JudgeSpec[] = (process.env.BENCH_PANEL
  ? process.env.BENCH_PANEL.split(',').map((s) => s.trim()).filter(Boolean)
  : ['openai:gpt-5.6-sol', 'anthropic:claude-opus-4-8', 'gemini:gemini-3.1-pro-preview', 'xai:grok-4.20-0309-reasoning']
).map(parseJudgeSpec);
