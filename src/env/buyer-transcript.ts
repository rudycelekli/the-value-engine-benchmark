/**
 * Frozen buyer-sim transcripts: record/replay for the LLM buyer.
 *
 * The buyer's LLM only ever generates reply *text*; all reward-bearing state
 * (facts released, trust, meetings, discount, veto) is governed by the
 * deterministic BuyerStateMachine and is independent of the buyer's words.
 * That means we can freeze the buyer's stochastic prose (Claude at t=0.8 is
 * not seed-reproducible) into a transcript and replay it verbatim, and the
 * scenario's reward reproduces bit-for-bit — turning a live agentic env into
 * a deterministically replayable one WITHOUT weakening reward verifiability.
 *
 * Keying: replies are captured in call order via a per-episode ordinal
 * (`${personaId}:${kind}:${ordinal}` built in BuyerAgent). Because episode
 * control flow is driven by SELLER text (buyer prose never feeds gating or
 * terminal decisions), a scripted seller produces the same ordinal sequence
 * on record and replay, so keys line up.
 *
 * Freeze enforcement: a transcript stamps the buyer-sim version it was
 * recorded against; `assertFreeze` refuses to replay it under a different
 * buyer-sim (model/temperature/state-machine change), so a stale env can
 * never masquerade as a current one.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TranscriptMode = 'record' | 'replay';

export interface TranscriptMeta {
  /** buyerSimVersion() at record time — the freeze key. */
  buyerSim: string;
  /** sha256 of the scenario world the transcript was recorded for. */
  taskChecksum: string;
  seed: number | null;
}

export interface TranscriptEntry {
  key: string;
  personaId: string;
  kind: 'call' | 'email';
  text: string;
}

const FILE = 'buyer-transcript.json';

export class BuyerTranscript {
  readonly mode: TranscriptMode;
  readonly meta: TranscriptMeta;
  private readonly store: Map<string, TranscriptEntry>;

  constructor(mode: TranscriptMode, meta: TranscriptMeta, entries: TranscriptEntry[] = []) {
    this.mode = mode;
    this.meta = meta;
    this.store = new Map(entries.map((e) => [e.key, e]));
  }

  /** Capture one buyer reply (record mode only). Keys are append-once. */
  record(key: string, personaId: string, kind: 'call' | 'email', text: string): void {
    if (this.mode !== 'record') throw new Error(`record() called on a ${this.mode} transcript`);
    if (this.store.has(key)) throw new Error(`duplicate transcript key '${key}'`);
    this.store.set(key, { key, personaId, kind, text });
  }

  /** Return the frozen reply for a key (replay mode only). Missing key is fatal. */
  replay(key: string): string {
    if (this.mode !== 'replay') throw new Error(`replay() called on a ${this.mode} transcript`);
    const e = this.store.get(key);
    if (!e) throw new Error(`no recorded buyer turn for key '${key}' — transcript is incomplete or out of sync`);
    return e.text;
  }

  /**
   * Refuse to replay a transcript recorded against a different frozen buyer-sim
   * (or, if a checksum is supplied, a different scenario world).
   */
  assertFreeze(currentBuyerSim: string, currentTaskChecksum?: string): void {
    if (this.meta.buyerSim !== currentBuyerSim) {
      throw new Error(
        `buyer-sim version mismatch: transcript recorded against '${this.meta.buyerSim}', current is '${currentBuyerSim}' — refusing to replay a stale environment`,
      );
    }
    if (currentTaskChecksum && this.meta.taskChecksum !== currentTaskChecksum) {
      throw new Error(
        `task_checksum mismatch: transcript is for a different scenario world (${this.meta.taskChecksum} != ${currentTaskChecksum})`,
      );
    }
  }

  entries(): TranscriptEntry[] {
    return [...this.store.values()];
  }

  get size(): number {
    return this.store.size;
  }

  save(dir: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, FILE);
    writeFileSync(path, JSON.stringify({ meta: this.meta, entries: this.entries() }, null, 2), 'utf8');
    return path;
  }

  static load(dir: string): BuyerTranscript {
    const raw = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as {
      meta: TranscriptMeta;
      entries: TranscriptEntry[];
    };
    return new BuyerTranscript('replay', raw.meta, raw.entries);
  }
}
