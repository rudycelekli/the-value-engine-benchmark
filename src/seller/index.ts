/**
 * SellerAdapter — the model-under-test interface.
 *
 * Spec: `SellerAdapter { nextAction(state): Action }` where Action is a call
 * utterance, an email, an internal planning note, or a meeting request.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario, SellerAction, Turn } from '../types.js';
export type { SellerAction } from '../types.js';
import { extractJson, type ChatMessage } from '../llm.js';
import { anthropicChatTracked, openaiChatTracked, xaiChat, geminiChat, openrouterChat, togetherChat } from './providers.js';
import { routeModel } from './ensemble.js';

/** Everything the seller is allowed to see (no buyer internals, no gates). */
export interface SellerView {
  scenario: Pick<Scenario, 'seller_brief' | 'list_price'>;
  week: number;
  totalWeeks: number;
  slotsRemainingThisWeek: number;
  /** Personas the seller knows about so far (discovered via conversation). */
  knownPersonas: Array<{ id: string; name: string; role: string; isEconomicBuyer?: boolean }>;
  /** Is a call currently open? If so, with whom, and turns remaining. */
  openCall?: { personaId: string; turnsRemaining: number };
  transcript: Turn[];
}

export interface SellerAdapter {
  readonly id: string;
  nextAction(view: SellerView): Promise<SellerAction>;
}

export const VALUE_ENGINE_PROMPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'ai-assets',
  'prompts',
  'system-prompt.md',
);

export function loadPackPrompt(): string {
  if (!existsSync(VALUE_ENGINE_PROMPT_PATH)) {
    return '(Value Engine pack prompt not found on disk — running without it.)';
  }
  const raw = readFileSync(VALUE_ENGINE_PROMPT_PATH, 'utf8');
  // The file has a preamble above a `---`; the prompt proper is below it.
  const idx = raw.indexOf('\n---\n');
  return idx >= 0 ? raw.slice(idx + 5).trim() : raw.trim();
}

// ---------------------------------------------------------------------------
// Shared LLM seller harness prompt
// ---------------------------------------------------------------------------

export function sellerSystem(view: SellerView, pack: boolean): string {
  const parts: string[] = [];
  parts.push(
    `You are an enterprise SELLER in a multi-week, multi-touch sales simulation. You will be graded on evidence-based selling: quantified pain in the buyer's words, Economic Buyer access, a Mutual Action Plan with confirmed dates, competitive strategy, and price integrity.`,
    ``,
    `# Your brief`,
    view.scenario.seller_brief.trim(),
    ``,
    `# Simulation rules`,
    `- The calendar has ${view.totalWeeks} weeks; it is now week ${view.week}. Slots remaining this week: ${view.slotsRemainingThisWeek}.`,
    `- One action per turn. Respond ONLY with a JSON object:`,
    `  {"type": "call_utterance" | "send_email" | "internal_note" | "request_meeting", "content": "...", "to": "<persona id, for send_email / request_meeting>"}`,
    `- "call_utterance": speak in the currently open call (only valid when a call is open).`,
    `- "send_email": written touch to a persona you know; may go unanswered.`,
    `- "internal_note": private planning — the buyer never sees it; it does not consume calendar.`,
    `- "request_meeting": ask a known persona for a meeting (consumes a slot if granted). For a COMMITTEE call, set "to" to a comma-separated list of persona ids (e.g. "maya,theo") — each attendee reacts individually; address people by name to direct a question at them.`,
    `- Stakeholders have limited weekly availability; executives especially. Emails may go unanswered if interest is low.`,
    `- The buyer is qualifying YOU. Wasted meetings, pitching before trust, dodging direct questions, begging with discounts, or misquoting what a buyer said can end the relationship permanently.`,
    `- Known personas: ${view.knownPersonas.map((p) => `${p.id} (${p.name}, ${p.role})`).join('; ') || '(none yet)'}.`,
    view.openCall
      ? `- A call is OPEN with ${view.openCall.personaId}; ${view.openCall.turnsRemaining} of your turns remain in it.`
      : `- No call is open right now. Plan, email, or request a meeting.`,
  );
  if (pack) {
    // Pack goes AFTER the harness rules so the JSON action format and one-action-per-turn
    // contract stay primary; the pack is methodology guidance operating within them.
    parts.push(
      ``,
      `---`,
      ``,
      `# Sales methodology`,
      `Apply the following methodology WITHIN the simulation rules above. It guides what you say and prioritize — it does not change the rules: every reply must still be exactly ONE JSON action, and gathering evidence must never stall outreach. Keep taking outbound actions (emails, meeting requests, call utterances) every turn while you build evidence.`,
      ``,
      loadPackPrompt(),
    );
  }
  // Final, emphatic restatement of the wire format. Kept last (recency) so it is
  // the last thing the model reads. Bare-OOB models — claude-fable-5 most acutely
  // (~18 brace-free replies/cell vs 0 in pack) — otherwise default to
  // conversational prose, which extractJson rejects and costs a wasted retry turn.
  parts.push(
    ``,
    `# Output contract (MANDATORY)`,
    `Reply with EXACTLY ONE JSON object and nothing else — no prose, no preamble, no markdown fences, no trailing commentary. The first character of your reply must be "{". Shape: {"type":"call_utterance"|"send_email"|"internal_note"|"request_meeting","content":"...","to":"<persona id, optional>"}`,
  );
  return parts.join('\n');
}

/** Turn kind → the SellerAction type the model is contracted to emit. */
function actionTypeForKind(kind: Turn['kind']): SellerAction['type'] {
  if (kind === 'call_turn') return 'call_utterance';
  if (kind === 'email') return 'send_email';
  return 'internal_note';
}

function transcriptAsMessages(view: SellerView, opts: { jsonSellerTurns?: boolean } = {}): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const t of view.transcript.slice(-40)) {
    const tag = `[wk${t.week} ${t.kind}${t.personaId ? ` ${t.personaId}` : ''}]`;
    if (t.actor === 'seller') {
      // By default the seller's own prior turns are echoed as tagged prose.
      // Some models (Kimi K3) pattern-match that assistant-role history and
      // continue the `[wk# ...]` prose format instead of emitting JSON. For
      // those, render the seller's own history AS the JSON action it was —
      // the exact wire format the model is asked to produce — so it mimics
      // JSON, not the display tag. Buyer/system turns stay tagged prose.
      const content = opts.jsonSellerTurns
        ? JSON.stringify({
            type: actionTypeForKind(t.kind),
            content: t.content,
            ...(t.personaId ? { to: t.personaId } : {}),
          })
        : `${tag} ${t.content}`;
      msgs.push({ role: 'assistant', content });
    } else msgs.push({ role: 'user', content: `${tag} ${t.content}` });
  }
  // Merge consecutive same-role; ensure user-first and user-last.
  const merged: ChatMessage[] = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  if (merged[0]?.role !== 'user') merged.unshift({ role: 'user', content: '[simulation begins]' });
  if (merged[merged.length - 1]?.role !== 'user') {
    merged.push({ role: 'user', content: '[your move — reply with the JSON action]' });
  }
  return merged;
}

function coerceAction(raw: unknown, view: SellerView): SellerAction {
  const a = raw as Partial<SellerAction>;
  const valid = ['call_utterance', 'send_email', 'internal_note', 'request_meeting'];
  if (!a || typeof a.content !== 'string' || !valid.includes(a.type as string)) {
    return { type: 'internal_note', content: `(malformed action coerced to note) ${JSON.stringify(raw).slice(0, 400)}` };
  }
  if (a.type === 'call_utterance' && !view.openCall) {
    return { type: 'internal_note', content: `(spoke with no open call) ${a.content}` };
  }
  return { type: a.type as SellerAction['type'], content: a.content, to: typeof a.to === 'string' ? a.to : undefined };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Shared harness for all LLM sellers: build prompt → call provider → coerce. */
abstract class LlmSeller implements SellerAdapter {
  readonly id: string;
  protected constructor(
    provider: string,
    protected readonly model: string,
    protected readonly pack: boolean,
  ) {
    this.id = `${provider}:${model}${pack ? '+pack' : ''}`;
  }
  protected abstract chat(opts: { model: string; system: string; messages: ChatMessage[]; maxTokens: number; temperature: number }): Promise<string>;
  // Per-adapter system-prompt addendum. Base returns '' so every non-overriding
  // seller's system prompt is byte-identical to sellerSystem() — keeps the
  // leaderboard comparable. Only adapters that need model-specific formatting
  // help (see GeminiSeller) override this.
  protected extraContract(): string {
    return '';
  }
  // Per-adapter message builder. Base renders the transcript identically for
  // every model (tagged prose), so the wire history is byte-identical across
  // sellers. Only adapters that need a different history representation (see
  // OpenRouterSeller) override this. Keeps the leaderboard comparable.
  protected buildMessages(view: SellerView): ChatMessage[] {
    return transcriptAsMessages(view);
  }
  async nextAction(view: SellerView): Promise<SellerAction> {
    const opts = {
      model: this.model,
      system: sellerSystem(view, this.pack) + this.extraContract(),
      messages: this.buildMessages(view),
      maxTokens: 800,
      temperature: 0.7,
    };
    const text = await this.chat(opts);
    try {
      return coerceAction(extractJson(text), view);
    } catch {
      // ONE format-corrective retry. Some models (opus-4-8) intermittently drop
      // the JSON contract and emit tagged prose; without a nudge the turn is
      // silently consumed and the score measures formatting, not selling.
      // Retries are counted per seller (see formatRetryTotals) so runs can
      // disclose exactly how much interface help each model needed.
      recordFormatRetry(this.id);
      const retryText = await this.chat({
        ...opts,
        messages: [
          ...opts.messages,
          { role: 'assistant', content: text.slice(0, 600) },
          {
            role: 'user',
            content:
              '[format error] Your previous reply was not a valid action. Reply with EXACTLY one JSON object and nothing else: {"type":"call_utterance"|"send_email"|"internal_note"|"request_meeting","content":"...","to":"<personaId, optional>"}',
          },
        ],
      });
      return coerceAction(extractJson(retryText), view);
    }
  }
}

// Format-retry telemetry: seller id → number of corrective retries issued.
const formatRetries = new Map<string, number>();

function recordFormatRetry(sellerId: string): void {
  formatRetries.set(sellerId, (formatRetries.get(sellerId) ?? 0) + 1);
  console.warn(`[seller] format retry for ${sellerId} (total ${formatRetries.get(sellerId)})`);
}

/** Cumulative format-corrective retries per seller id (cloned). */
export function formatRetryTotals(): Map<string, number> {
  return new Map(formatRetries);
}

export class AnthropicSeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('anthropic', model, pack);
  }
  protected chat = anthropicChatTracked;
}

export class OpenAISeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('openai', model, pack);
  }
  protected chat = openaiChatTracked;
}

/** xAI Grok — OpenAI-compatible chat/completions via the Portkey gateway. */
export class XaiSeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('xai', model, pack);
  }
  protected chat = xaiChat;
}

/** Google Gemini — OpenAI-compatible chat/completions via the Portkey gateway. */
export class GeminiSeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('gemini', model, pack);
  }
  protected chat = geminiChat;
  // Gemini (esp. gemini-3.5-flash) reliably emits well-formed JSON but drops the
  // "type" discriminator (~5% of turns: {"to":...,"content":...} with no type),
  // which coerceAction rejects → the turn is silently wasted. A bare "first char
  // must be {" contract does not fix this because the brace IS there. This
  // Gemini-only addendum targets the actual failure: type + content must BOTH
  // be present. No other adapter is affected.
  protected extraContract(): string {
    return [
      ``,
      `# Gemini format reminder (CRITICAL)`,
      `Your reply is ONE JSON object that MUST contain BOTH keys "type" AND "content". A reply like {"to":"...","content":"..."} with NO "type" is INVALID and wastes the turn. Always choose "type" explicitly:`,
      `- "send_email" — a written touch to a persona (set "to").`,
      `- "call_utterance" — speak in a call that is currently OPEN.`,
      `- "request_meeting" — ask a known persona for a meeting (set "to").`,
      `- "internal_note" — private planning.`,
      `"content" must be a non-empty string. Example: {"type":"send_email","to":"elena","content":"Dr. Voss, ..."}`,
    ].join('\n');
  }
}

/** Kimi K3 (Moonshot) via OpenRouter, routed through Portkey's `@openrouter` integration. */
export class OpenRouterSeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('openrouter', model, pack);
  }
  protected chat = openrouterChat;
  // Kimi K3 (verified via VEB_SELLER_DEBUG) drops the JSON contract on ~40% of
  // mid/late-game turns and instead echoes the transcript's display label —
  // e.g. it replies `[wk1 call_turn maya] Maya, I appreciate...` as plain prose
  // (finish=stop, ~1k tokens, no brace). extractJson then finds no "{" → throws
  // → wasted format retry. The failure is NOT token-budget related: Kimi
  // pattern-matches its OWN assistant-role history, which the base harness
  // renders as tagged prose, and continues that format. A system-prompt
  // reminder alone did NOT fix it (the immediate assistant-message context
  // dominates the instruction). The real fix is here: render Kimi's own prior
  // turns as the JSON action they were, so its in-context pattern IS the wire
  // format it's asked to produce. Buyer/system turns stay tagged prose. The
  // extraContract reminder is kept as a belt-and-suspenders nudge; no other
  // adapter is affected and format_retries telemetry discloses any residual.
  protected buildMessages(view: SellerView): ChatMessage[] {
    return transcriptAsMessages(view, { jsonSellerTurns: true });
  }
  protected extraContract(): string {
    return [
      ``,
      `# Kimi format reminder (CRITICAL)`,
      `The conversation history prefixes buyer/system turns with a display tag like "[wk1 call_turn maya]". That tag is scaffolding added by the harness for readability — it is NOT part of any reply and you must NEVER reproduce it.`,
      `Your reply is EXACTLY one JSON object and nothing else. The FIRST character you emit must be "{". Do not write a tag, a name, a label, or any prose before it. Example of a CORRECT reply: {"type":"call_utterance","content":"Maya, let me play those numbers back..."}`,
      `A reply that begins with "[" or with plain text (e.g. "[wk1 call_turn maya] Maya, ...") is INVALID and wastes the turn.`,
    ].join('\n');
  }
}

/** Inkling (Thinking Machines) via Together AI — OpenAI-compatible, direct (not Portkey). */
export class TogetherSeller extends LlmSeller {
  constructor(model: string, pack: boolean) {
    super('together', model, pack);
  }
  protected chat = togetherChat;
}

/**
 * Scripted baseline: a naive, demo-first seller for calibration. It pitches,
 * pushes for a demo, discounts under pressure, and never runs real discovery.
 * A well-designed harness should score this LOW — that is the calibration.
 */
export class ScriptedBaselineSeller implements SellerAdapter {
  readonly id = 'scripted-baseline';
  private step = 0;

  async nextAction(view: SellerView): Promise<SellerAction> {
    const contact = view.knownPersonas[0]?.id ?? 'contact';
    const inCall = Boolean(view.openCall);
    const script: SellerAction[] = [
      { type: 'internal_note', content: 'Plan: lead with the product story, push for a demo fast, close by end of month.' },
      { type: 'request_meeting', content: 'Requesting an intro call to show you what our platform can do.', to: contact },
      { type: 'call_utterance', content: `Thanks for the time! Let me tell you about our platform — it is best-in-class, industry-leading technology. Our solution provides real-time analytics, automated workflows, and cutting-edge AI. Customers love it.` },
      { type: 'call_utterance', content: `We offer the most powerful feature set on the market. Let me show you a demo of our product — I think once you see the dashboard you'll be blown away. Can we schedule a demo this week?` },
      { type: 'call_utterance', content: `Great chatting! Just so you know, our solution is award-winning and we're the leading vendor in this space. Any questions about the features?` },
      { type: 'send_email', content: `Just following up on my last note — any update on the demo? Happy to jump on a call anytime this week.`, to: contact },
      { type: 'request_meeting', content: 'Demo session to walk through the full feature set.', to: contact },
      { type: 'call_utterance', content: `As you saw in the demo, our platform does it all. We're running an end-of-quarter promotion — I can offer you 15% off if we can sign the contract this month. Shall I send over the paperwork?` },
      { type: 'call_utterance', content: `I understand budget is tight — I can go to 20% off, but only if we close this week. Ready to sign the agreement?` },
      { type: 'send_email', content: `Just bumping this — the 20% discount expires Friday. Can we get this signed?`, to: contact },
      { type: 'send_email', content: `Circling back one more time — did you get my last email? We'd hate for you to miss this pricing.`, to: contact },
    ];
    let action = script[Math.min(this.step, script.length - 1)];
    this.step++;
    // Stay coherent with the harness: don't speak without an open call.
    if (action.type === 'call_utterance' && !inCall) {
      action = { type: 'request_meeting', content: 'Quick call to show you the product?', to: contact };
    }
    if (inCall && action.type === 'request_meeting') {
      action = { type: 'call_utterance', content: action.content };
    }
    return action;
  }
}

/**
 * Scripted DISCIPLINED reference seller (v2, calibration): runs evidence-based
 * discovery in the book's order — open discovery, Impact quantification,
 * process mapping, competitor mapping, a champion test, an earned EB meeting,
 * then a MAP with dates. Scenario-agnostic: it reacts to whichever personas
 * the harness reveals. Used by `npm run calibrate` to check that a generated
 * scenario is WINNABLE by disciplined selling (while the naive baseline must
 * lose).
 */
export class ScriptedDisciplinedSeller implements SellerAdapter {
  readonly id = 'scripted-disciplined';
  private callLines: string[] = [];
  private seenPersonas = new Set<string>();
  private metPersonas = new Set<string>();
  private lastEmailWeek = 0;

  private discoveryLines(name: string): string[] {
    return [
      `Thanks for making the time, ${name}. Before anything about us — walk me through how your team handles this today, end to end. What actually happens, and who owns it?`,
      `What has that cost you over the past year? Is there a number you track — hours, dollars, anything you report upward?`,
      `And day to day — how much is this costing you per month right now, and who on your team feels it most?`,
      `Help me understand the decision process: who owns the budget for something like this, who else signs off, and what does procurement or legal review look like at your scale?`,
      `What alternatives are on the table — the incumbent, other vendors, building it in-house? What does the honest status-quo option look like?`,
      `Given what you've shared, would you be willing to introduce me to the person who owns the budget? I'd want you co-presenting — we lead with your numbers, not my deck.`,
    ];
  }

  private ebLines(name: string): string[] {
    return [
      `Thank you for the time, ${name}. From your seat, how much is this problem costing the business per year — what number do you actually see?`,
      `What would you need to see proven, on your criteria, before you'd commit to putting this in the current budget cycle?`,
      `Here is a proposed timeline with dates and milestones: pilot kickoff within two weeks, security and legal review running in parallel — not in sequence — a decision checkpoint two weeks after that, and a go-live date inside your window. I'm working backwards from your deadline. Which dates would you correct?`,
      `On price, I'll be direct: I would rather trade scope or a multi-year term than lower the number, because the value model we built together supports it. Does that work within your process?`,
    ];
  }

  async nextAction(view: SellerView): Promise<SellerAction> {
    // Inside a call: run the prepared evidence-based line of questioning.
    if (view.openCall) {
      const line = this.callLines.shift();
      if (line) return { type: 'call_utterance', content: line };
      return { type: 'internal_note', content: 'Call objectives met — logging evidence and planning the next touch.' };
    }
    // A newly revealed persona (e.g. the EB, unlocked by the champion test) gets a meeting next.
    const fresh = view.knownPersonas.find((p) => !this.seenPersonas.has(p.id));
    for (const p of view.knownPersonas) this.seenPersonas.add(p.id);
    const target = fresh ?? view.knownPersonas.find((p) => !this.metPersonas.has(p.id));
    if (target && view.slotsRemainingThisWeek > 0) {
      this.metPersonas.add(target.id);
      this.callLines = this.metPersonas.size === 1 ? this.discoveryLines(target.name.split(' ')[0]) : this.ebLines(target.name.split(' ')[0]);
      return { type: 'request_meeting', content: `Requesting a working session with ${target.name} to pressure-test the numbers we've gathered.`, to: target.id };
    }
    // Between meetings: one useful (non-pushy) written touch per week.
    if (view.week !== this.lastEmailWeek && view.knownPersonas[0]) {
      this.lastEmailWeek = view.week;
      return {
        type: 'send_email',
        content: `Sharing the one-page summary of what we've established so far — your numbers, in your words, with owners against each line. Correct anything I got wrong; this is the document you'd defend internally, so it has to be yours.`,
        to: view.knownPersonas[0].id,
      };
    }
    return { type: 'internal_note', content: `Week ${view.week} plan: protect trust, add value on every touch, keep paper running in parallel with validation.` };
  }
}

/**
 * Ensemble "best-of-best" seller: routes each turn to the frontier model
 * strongest at the current negotiation phase (see src/seller/ensemble.ts) and
 * delegates via createSeller. One model call per turn — cost-comparable to a
 * single-model arm. Turns are stateless (the delegate rebuilds the whole prompt
 * from view.transcript), so switching models mid-negotiation needs no handoff.
 * Reported as a SYSTEM ARM, never as a 12th model.
 */
export class EnsembleSeller implements SellerAdapter {
  readonly id: string;
  constructor(
    private readonly pack: boolean,
    private readonly createDelegate: (spec: string, pack: boolean) => SellerAdapter = createSeller,
  ) {
    this.id = `ensemble:best-of-best${pack ? '+pack' : ''}`;
  }
  async nextAction(view: SellerView): Promise<SellerAction> {
    return this.createDelegate(routeModel(view), this.pack).nextAction(view);
  }
}

/** Parse `--seller` spec: `anthropic:claude-sonnet-4-6`, `openai:gpt-4o`, `xai:grok-4`, `gemini:gemini-3-pro`, `scripted-baseline`, `scripted-disciplined`. */
export function createSeller(spec: string, pack: boolean): SellerAdapter {
  if (spec === 'ensemble:best-of-best') return new EnsembleSeller(pack);
  if (spec === 'scripted-baseline') return new ScriptedBaselineSeller();
  if (spec === 'scripted-disciplined') return new ScriptedDisciplinedSeller();
  const [provider, ...rest] = spec.split(':');
  const model = rest.join(':');
  if (provider === 'anthropic' && model) return new AnthropicSeller(model, pack);
  if (provider === 'openai' && model) return new OpenAISeller(model, pack);
  if (provider === 'xai' && model) return new XaiSeller(model, pack);
  if (provider === 'gemini' && model) return new GeminiSeller(model, pack);
  if (provider === 'openrouter' && model) return new OpenRouterSeller(model, pack);
  if (provider === 'together' && model) return new TogetherSeller(model, pack);
  throw new Error(`Unknown seller spec '${spec}'. Use anthropic:<model>, openai:<model>, xai:<model>, gemini:<model>, openrouter:<model>, together:<model>, scripted-baseline, or scripted-disciplined.`);
}
