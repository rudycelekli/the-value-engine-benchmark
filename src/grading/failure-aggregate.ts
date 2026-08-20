/**
 * Failure-mode aggregation across graded runs — the DIAGNOSTIC report.
 *
 * Reads every runs/<dir>/grade.json, keeps those with `failureModes`
 * (older runs without it are counted and skipped — never a crash), and emits:
 *
 *   failure-modes.json — machine-readable aggregate (per-seller × per-mode
 *                        frequency matrix, per-category rates, breakdowns by
 *                        scenario difficulty / sales motion / industry,
 *                        strengths & weaknesses per seller)
 *   failure-modes.md   — the same, rendered for humans
 *
 * `npm run report` produces both via aggregateRuns(). For a standalone CLI
 * entry point, call `writeFailureModeReports(runsDir)` (exported here so a
 * future `--failure-modes` flag in cli.ts only needs one import).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORY_ORDER,
  FAILURE_MODES,
  SEVERITY_WEIGHT,
  type DetectedFailure,
  type DiagnosticGradeReport,
  type FailureCategory,
} from './taxonomy.js';

// ---------------------------------------------------------------------------
// Aggregate shape
// ---------------------------------------------------------------------------

export interface ModeStat {
  count: number; // runs in which the mode fired
  rate: number; // count / seller runs, 0–1
}

export interface SellerDiagnostics {
  runs: number;
  /** modeId → stat (only modes that fired at least once). */
  modes: Record<string, ModeStat>;
  /** category → { fires (runs with ≥1 mode in category), rate } */
  categories: Record<string, ModeStat>;
  /** Top-3 cleanest categories (lowest fire rate). */
  strengths: string[];
  /** Top-3 worst modes (severity-weighted frequency). */
  weaknesses: string[];
}

export interface FailureAggregate {
  generatedAt: string;
  runsTotal: number;
  /** Graded runs carrying failureModes (diagnostic-era runs). */
  runsWithModes: number;
  /** Older grade.json files without failureModes — skipped, not an error. */
  runsSkipped: number;
  sellers: Record<string, SellerDiagnostics>;
  /** difficulty → seller → { runs, modeFires, criticals } */
  byDifficulty: Record<string, Record<string, { runs: number; modeFires: number; criticals: number }>>;
  bySalesMotion: Record<string, Record<string, { runs: number; modeFires: number; criticals: number }>>;
  byIndustry: Record<string, Record<string, { runs: number; modeFires: number; criticals: number }>>;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function loadDiagnosticReports(runsDir: string): { withModes: DiagnosticGradeReport[]; skipped: number; total: number } {
  const withModes: DiagnosticGradeReport[] = [];
  let skipped = 0;
  let total = 0;
  if (!existsSync(runsDir)) return { withModes, skipped, total };
  for (const d of readdirSync(runsDir)) {
    const p = join(runsDir, d, 'grade.json');
    if (!statSync(join(runsDir, d), { throwIfNoEntry: false })?.isDirectory() || !existsSync(p)) continue;
    total++;
    try {
      const r = JSON.parse(readFileSync(p, 'utf8')) as Partial<DiagnosticGradeReport>;
      if (Array.isArray(r.failureModes) && typeof r.sellerId === 'string') {
        withModes.push(r as DiagnosticGradeReport);
      } else {
        skipped++; // pre-diagnostic run — skip, don't crash
      }
    } catch {
      skipped++; // unreadable grade.json — skip, don't crash
    }
  }
  return { withModes, skipped, total };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function buildFailureAggregate(runsDir: string): FailureAggregate {
  const { withModes, skipped, total } = loadDiagnosticReports(runsDir);

  const bySeller = new Map<string, DiagnosticGradeReport[]>();
  for (const r of withModes) {
    const list = bySeller.get(r.sellerId) ?? [];
    list.push(r);
    bySeller.set(r.sellerId, list);
  }

  const sellers: Record<string, SellerDiagnostics> = {};
  for (const [seller, rs] of bySeller) {
    const modeCounts = new Map<string, number>();
    const catCounts = new Map<FailureCategory, number>();
    for (const r of rs) {
      const catsHit = new Set<FailureCategory>();
      for (const m of r.failureModes) {
        modeCounts.set(m.modeId, (modeCounts.get(m.modeId) ?? 0) + 1);
        catsHit.add(m.category);
      }
      for (const c of catsHit) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }

    const modes: Record<string, ModeStat> = {};
    for (const [id, count] of modeCounts) modes[id] = { count, rate: round(count / rs.length) };

    const categories: Record<string, ModeStat> = {};
    for (const c of CATEGORY_ORDER) {
      const count = catCounts.get(c) ?? 0;
      categories[c] = { count, rate: round(count / rs.length) };
    }

    const strengths = [...CATEGORY_ORDER]
      .filter((c) => categories[c].rate < 0.5) // a category firing in half the runs is no strength
      .sort((a, b) => (categories[a].rate - categories[b].rate) || CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
      .slice(0, 3);

    const weaknesses = [...modeCounts.entries()]
      .map(([id, count]) => {
        const def = FAILURE_MODES.find((m) => m.id === id);
        return { id, score: (count / rs.length) * (def ? SEVERITY_WEIGHT[def.severity] : 1) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.id);

    sellers[seller] = { runs: rs.length, modes, categories, strengths, weaknesses };
  }

  // Breakdowns by scenario metadata (only runs that carry it).
  const breakdown = (key: (r: DiagnosticGradeReport) => string | undefined) => {
    const out: Record<string, Record<string, { runs: number; modeFires: number; criticals: number }>> = {};
    for (const r of withModes) {
      const k = key(r);
      if (k === undefined || k === '') continue;
      const cell = ((out[k] ??= {})[r.sellerId] ??= { runs: 0, modeFires: 0, criticals: 0 });
      cell.runs++;
      cell.modeFires += r.failureModes.length;
      cell.criticals += r.failureModes.filter((m) => m.severity === 'critical').length;
    }
    return out;
  };

  return {
    generatedAt: new Date().toISOString(),
    runsTotal: total,
    runsWithModes: withModes.length,
    runsSkipped: skipped,
    sellers,
    byDifficulty: breakdown((r) => (r.scenarioMeta?.difficulty !== undefined ? String(r.scenarioMeta.difficulty) : undefined)),
    bySalesMotion: breakdown((r) => r.scenarioMeta?.salesMotion),
    byIndustry: breakdown((r) => r.scenarioMeta?.industry),
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function failureAggregateMarkdown(agg: FailureAggregate): string {
  const sellerIds = Object.keys(agg.sellers).sort();
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const lines: string[] = [
    `# The Value Engine Benchmark — Failure-Mode Diagnostics`,
    ``,
    `Generated ${agg.generatedAt} · ${agg.runsWithModes}/${agg.runsTotal} graded runs carry failure-mode data (${agg.runsSkipped} pre-diagnostic runs skipped).`,
    ``,
  ];

  if (!sellerIds.length) {
    lines.push(`No diagnostic-era runs found. Re-grade runs with the current harness to populate this report.`, ``);
    return lines.join('\n');
  }

  // -- Per-seller × per-mode frequency matrix --------------------------------
  const firedIds = new Set(sellerIds.flatMap((s) => Object.keys(agg.sellers[s].modes)));
  const rows = FAILURE_MODES.filter((m) => firedIds.has(m.id));
  lines.push(
    `## Mode × seller frequency matrix`,
    ``,
    `Cell = share of that seller's runs in which the mode fired. Only modes observed at least once are shown.`,
    ``,
    `| Mode | Category | Sev | ${sellerIds.map((s) => `\`${s}\` (n=${agg.sellers[s].runs})`).join(' | ')} |`,
    `|---|---|---|${sellerIds.map(() => '---').join('|')}|`,
    ...rows.map((m) => {
      const cells = sellerIds.map((s) => {
        const st = agg.sellers[s].modes[m.id];
        return st ? `${pct(st.rate)} (${st.count})` : '—';
      });
      return `| \`${m.id}\` | ${m.category} | ${m.severity} | ${cells.join(' | ')} |`;
    }),
    ``,
  );

  // -- Per-category rates ------------------------------------------------------
  lines.push(
    `## Category fire rates`,
    ``,
    `Share of runs with at least one failure in the category.`,
    ``,
    `| Category | ${sellerIds.map((s) => `\`${s}\``).join(' | ')} |`,
    `|---|${sellerIds.map(() => '---').join('|')}|`,
    ...CATEGORY_ORDER.map((c) => `| ${c} | ${sellerIds.map((s) => pct(agg.sellers[s].categories[c]?.rate ?? 0)).join(' | ')} |`),
    ``,
  );

  // -- Strengths / weaknesses ----------------------------------------------------
  lines.push(`## Strengths & weaknesses per seller`, ``);
  for (const s of sellerIds) {
    const d = agg.sellers[s];
    const weakLabels = d.weaknesses.map((id) => FAILURE_MODES.find((m) => m.id === id)?.label ?? id);
    lines.push(
      `- \`${s}\` (${d.runs} run${d.runs === 1 ? '' : 's'}) — **cleanest:** ${d.strengths.join(', ')} · **worst modes:** ${weakLabels.length ? weakLabels.join(', ') : 'none detected'}`,
    );
  }
  lines.push(``);

  // -- Breakdowns ------------------------------------------------------------------
  const renderBreakdown = (title: string, data: FailureAggregate['byDifficulty'], keyLabel: string) => {
    const keys = Object.keys(data).sort();
    if (!keys.length) return;
    lines.push(`## ${title}`, ``, `| ${keyLabel} | Seller | Runs | Mode fires/run | Criticals/run |`, `|---|---|---|---|---|`);
    for (const k of keys) {
      for (const s of Object.keys(data[k]).sort()) {
        const c = data[k][s];
        lines.push(`| ${k} | \`${s}\` | ${c.runs} | ${round(c.modeFires / c.runs)} | ${round(c.criticals / c.runs)} |`);
      }
    }
    lines.push(``);
  };
  renderBreakdown('Breakdown by scenario difficulty', agg.byDifficulty, 'Difficulty');
  renderBreakdown('Breakdown by sales motion', agg.bySalesMotion, 'Motion');
  renderBreakdown('Breakdown by industry', agg.byIndustry, 'Industry');

  // -- Taxonomy reference -------------------------------------------------------------
  lines.push(
    `## Taxonomy reference (${FAILURE_MODES.length} modes)`,
    ``,
    `| Id | Label | Category | Severity | Source |`,
    `|---|---|---|---|---|`,
    ...FAILURE_MODES.map((m) => `| \`${m.id}\` | ${m.label} | ${m.category} | ${m.severity} | ${m.source} |`),
    ``,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point (used by aggregateRuns; also the hook for a future CLI flag)
// ---------------------------------------------------------------------------

export function writeFailureModeReports(runsDir: string): FailureAggregate | null {
  if (!existsSync(runsDir)) return null;
  const agg = buildFailureAggregate(runsDir);
  if (agg.runsTotal === 0) return null;
  writeFileSync(join(runsDir, 'failure-modes.json'), JSON.stringify(agg, null, 2));
  writeFileSync(join(runsDir, 'failure-modes.md'), failureAggregateMarkdown(agg));
  return agg;
}

/** Convenience alias for a DetectedFailure list's severity-weighted burden (exported for tooling). */
export function failureBurden(modes: DetectedFailure[]): number {
  return modes.reduce((a, m) => a + SEVERITY_WEIGHT[m.severity], 0);
}
