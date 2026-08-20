/**
 * Multi-judge grading panel (offline, frozen-grid).
 *
 * The live harness grades each episode with one judge. For the paper we re-grade
 * every frozen episode with a 4-seat panel — the strongest grader from each
 * family (OpenAI / Anthropic / Gemini / xAI-reasoning) — and take the MEDIAN
 * Sale Quality Score as the panel score. Median (not mean) so one family's house
 * style or a single outlier judge cannot move the grade; with 4 seats it is the
 * mean of the two middle scores.
 *
 * The attached diagnostic report is the MEDOID — the judge whose SQS is closest
 * to the median — so the returned citations, rationales and failure modes are all
 * internally consistent (a real judge's opinion), not a field-by-field splice.
 *
 * `aggregatePanel` is pure over already-collected judge results, so it is unit
 * tested with fake reports and no LLM call. `gradePanel` is the thin async shell
 * that fans out the real judge calls and hands their results to the pure core.
 */

import type { Episode, Scenario } from '../types.js';
import type { DiagnosticGradeReport } from './taxonomy.js';
import { gradeEpisodeWith } from './judge.js';
import { PANEL, judgeId, type JudgeSpec } from './judge-providers.js';

/** One seat's outcome. A failed seat is excluded from the median (never heuristic-substituted). */
export interface JudgeResult {
  id: string;
  spec: JudgeSpec;
  ok: boolean;
  report?: DiagnosticGradeReport;
  error?: string;
}

export interface PanelReport {
  /** Median SQS across the OK seats — the frozen-grid score for this cell. */
  panelScore: number;
  /** Medoid judge's full diagnostic (headline SQS overwritten with the median). */
  consensus: DiagnosticGradeReport;
  /** Which seat supplied the consensus diagnostic. */
  medoidJudge: string;
  perJudge: Array<{ id: string; sqs: number; dvi: number; judge: 'llm' | 'heuristic' }>;
  agreement: {
    nOk: number;
    sqsMedian: number;
    sqsMin: number;
    sqsMax: number;
    /** max − min: quick disagreement read (0 = unanimous). */
    sqsSpread: number;
    /** population stdev of SQS across seats. */
    sqsStdev: number;
  };
  nFailed: number;
  failures: Array<{ id: string; error: string }>;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * Pure aggregation. Throws only if EVERY seat failed (no score to report).
 * The medoid is the OK seat whose SQS is closest to the median; ties break to
 * the lower SQS (conservative). The consensus report is that seat's report with
 * its saleQualityScore replaced by the panel median, and `judge` stamped 'llm'.
 */
export function aggregatePanel(results: JudgeResult[]): PanelReport {
  const ok = results.filter((r) => r.ok && r.report);
  const failures = results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error ?? 'unknown' }));
  if (ok.length === 0) {
    throw new Error(`Panel produced no gradable seats (${results.length} attempted, all failed).`);
  }

  const sqs = ok.map((r) => r.report!.saleQualityScore);
  const sqsMedian = median(sqs);
  const sqsMin = Math.min(...sqs);
  const sqsMax = Math.max(...sqs);

  // Medoid: closest to median, ties → lower SQS.
  let medoid = ok[0];
  let best = Infinity;
  for (const r of ok) {
    const d = Math.abs(r.report!.saleQualityScore - sqsMedian);
    if (d < best || (d === best && r.report!.saleQualityScore < medoid.report!.saleQualityScore)) {
      best = d;
      medoid = r;
    }
  }

  const consensus: DiagnosticGradeReport = {
    ...medoid.report!,
    saleQualityScore: sqsMedian,
    judge: 'llm',
  };

  return {
    panelScore: sqsMedian,
    consensus,
    medoidJudge: medoid.id,
    perJudge: ok.map((r) => ({ id: r.id, sqs: r.report!.saleQualityScore, dvi: r.report!.dvi.total, judge: r.report!.judge })),
    agreement: {
      nOk: ok.length,
      sqsMedian,
      sqsMin,
      sqsMax,
      sqsSpread: sqsMax - sqsMin,
      sqsStdev: stdev(sqs),
    },
    nFailed: failures.length,
    failures,
  };
}

/**
 * Fan out the panel over one episode. Seats run concurrently; a seat that throws
 * is captured as a failure (not fatal) so a single provider hiccup degrades the
 * panel to 3 seats rather than losing the cell. Requires the LLM path (a mock
 * episode or a missing PORTKEY_API_KEY yields all-failed → aggregatePanel throws).
 */
export async function gradePanel(episode: Episode, scenario: Scenario, roster: JudgeSpec[] = PANEL): Promise<PanelReport> {
  const results = await Promise.all(
    roster.map(async (spec): Promise<JudgeResult> => {
      const id = judgeId(spec);
      try {
        const report = await gradeEpisodeWith(episode, scenario, spec);
        return { id, spec, ok: true, report };
      } catch (err) {
        return { id, spec, ok: false, error: (err as Error).message };
      }
    }),
  );
  return aggregatePanel(results);
}
