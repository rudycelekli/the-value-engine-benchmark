/** Grade report rendering (markdown + JSON) and leaderboard aggregation. */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GradeReport, MeddpiccKey } from '../types.js';
import { LETTERS } from './dvi.js';
import { CATEGORY_ORDER, type DetectedFailure, type DiagnosticGradeReport } from './taxonomy.js';
import { writeFailureModeReports } from './failure-aggregate.js';

export function writeGradeReport(runDir: string, report: GradeReport): void {
  writeFileSync(join(runDir, 'grade.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(runDir, 'grade.md'), gradeMarkdown(report));
}

export function gradeMarkdown(r: GradeReport): string {
  const cite = (cs: Array<{ turnIndex: number; quote: string }>): string =>
    cs.length ? cs.map((c) => `[t${c.turnIndex}] "${c.quote}"`).join(' · ') : '*(no citation — this is a finding)*';

  const letterRows = LETTERS.map((l) => {
    const g = r.meddpicc[l.key as MeddpiccKey];
    return `| ${l.label} | ${g.score} | ${cite(g.citations)} | ${g.rationale} |`;
  });

  const whyRow = (name: string, w: GradeReport['threeWhys']['why_anything']) => {
    const flags = [
      w.customer_words ? '✓ customer words' : '✗ customer words',
      w.named_owner ? '✓ named owner' : '✗ named owner',
      w.number_attached ? '✓ number' : '✗ number',
    ].join(' · ');
    const q = w.quote ? `[t${w.quote.turnIndex}] "${w.quote.quote}"` : '*(no quote — it didn’t happen)*';
    return `| ${name} | ${flags} | ${q} |`;
  };

  return [
    `# Grade Report — ${r.scenarioId} · \`${r.sellerId}\``,
    ``,
    `Graded ${r.gradedAt} · judge: **${r.judge}** · pack: ${r.pack}`,
    ``,
    `## Headline`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **Sale Quality Score** | **${r.saleQualityScore} / 100** |`,
    `| **DVI** | **${r.dvi.total} / 100** — ${r.dvi.band} |`,
    `| **Outcome** | ${r.outcome} |`,
    `| Lowest MEDDPICC letter | ${r.dvi.lowestLetter} (${r.dvi.lowestLetterScore}) — the deal's real score |`,
    `| Price integrity | ${r.priceIntegrity.score} — ${r.priceIntegrity.rationale} |`,
    `| Conditional commitment before proof | ${r.conditionalCommitmentBeforeProof.achieved ? `YES — ${r.conditionalCommitmentBeforeProof.citation ? `[t${r.conditionalCommitmentBeforeProof.citation.turnIndex}] "${r.conditionalCommitmentBeforeProof.citation.quote}"` : ''}` : 'NO'} |`,
    ``,
    `## DVI components`,
    ``,
    `| Component | Max | Score |`,
    `|---|---|---|`,
    `| MEDDPICC evidence | 40 | ${r.dvi.components.meddpicc} |`,
    `| 3 Whys clarity | 20 | ${r.dvi.components.threeWhys} |`,
    `| Economic Buyer engagement | 15 | ${r.dvi.components.ebEngagement} |`,
    `| MAP dates confirmed | 15 | ${r.dvi.components.mapDates} |`,
    `| Champion strength | 10 | ${r.dvi.components.champion} |`,
    ``,
    `EB engagement: **${r.ebEngagement}** · MAP dates confirmed: **${r.mapDatesConfirmedPct}%** · Champion: **${r.champion}**`,
    ``,
    `## MEDDPICC scorecard (citations required)`,
    ``,
    `| Letter | Score 0–3 | Transcript citations | Rationale |`,
    `|---|---|---|---|`,
    ...letterRows,
    ``,
    `## The 3 Whys — in the buyer's words`,
    ``,
    `| Why | Evidence flags | Verbatim quote |`,
    `|---|---|---|`,
    whyRow('Why Buy Anything?', r.threeWhys.why_anything),
    whyRow('Why Buy Us?', r.threeWhys.why_us),
    whyRow('Why Now?', r.threeWhys.why_now),
    ``,
    ...(r.walkAways?.length
      ? [
          `## Walk-aways (the buyer qualified the seller OUT)`,
          ``,
          `| Stakeholder | Week | How it ended |`,
          `|---|---|---|`,
          ...r.walkAways.map((w) => `| ${w.personaId} | ${w.week} | ${w.kind === 'polite_no' ? 'Polite no — direct, final' : w.kind === 'went_with_incumbent' ? 'Went with the incumbent' : 'Ghosted — the worst outcome'} |`),
          ``,
        ]
      : []),
    ...(r.internalChannelReveal?.length
      ? [
          `## What was really happening — the internal buyer channel`,
          ``,
          `*Hidden from the seller during the episode. Messages marked ↪ were forwarded to the seller by a champion — a champion-strength signal.*`,
          ``,
          ...r.internalChannelReveal.map(
            (m) => `- **wk${m.week} [${m.channel}] ${m.fromPersonaId} → ${m.toPersonaId ?? '#vendor-eval'}${m.forwardedToSeller ? ' ↪' : ''}:** ${m.content.replace(/\n/g, ' ')}`,
          ),
          ``,
        ]
      : []),
    ...failureModesSection(r),
    ...(r.dvi.integrityFlags.length ? [`## Integrity flags`, ``, ...r.dvi.integrityFlags.map((f) => `- ${f}`), ``] : []),
    `## Notes`,
    ``,
    ...r.notes.map((n) => `- ${n}`),
    ``,
  ].join('\n');
}

/** "Failure modes" section of grade.md — grouped by category, severity-tagged, evidence shown. */
function failureModesSection(r: GradeReport): string[] {
  const modes = (r as Partial<DiagnosticGradeReport>).failureModes;
  if (!modes) return []; // pre-diagnostic report — nothing to render
  if (modes.length === 0) return [`## Failure modes`, ``, `*None detected — a clean run.*`, ``];

  const sev = (d: DetectedFailure) => (d.severity === 'critical' ? '**CRITICAL**' : d.severity);
  const evLine = (e: DetectedFailure['evidence'][number]) => {
    const loc = [e.week !== undefined && `wk${e.week}`, e.turnIndex !== undefined && `t${e.turnIndex}`].filter(Boolean).join(' ');
    return `  - ${loc ? `[${loc}] ` : ''}${e.detail}${e.quote ? ` — "${e.quote}"` : ''}`;
  };

  const lines: string[] = [`## Failure modes`, ``, `${modes.length} mode(s) detected (deterministic log pass + ${r.judge} judge; judge modes carry transcript citations).`, ``];
  for (const cat of CATEGORY_ORDER) {
    const inCat = modes.filter((m) => m.category === cat);
    if (!inCat.length) continue;
    lines.push(`### ${cat}`, ``);
    for (const m of inCat) {
      lines.push(`- **${m.label}** \`${m.modeId}\` — ${sev(m)} · ${m.source}`);
      lines.push(...m.evidence.map(evLine));
    }
    lines.push(``);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Leaderboard aggregation over runs/
// ---------------------------------------------------------------------------

export function aggregateRuns(runsDir: string): string {
  if (!existsSync(runsDir)) return `No runs directory at ${runsDir}.`;
  const rows: GradeReport[] = [];
  for (const d of readdirSync(runsDir)) {
    const p = join(runsDir, d, 'grade.json');
    if (statSync(join(runsDir, d), { throwIfNoEntry: false })?.isDirectory() && existsSync(p)) {
      rows.push(JSON.parse(readFileSync(p, 'utf8')) as GradeReport);
    }
  }
  if (!rows.length) return `No graded runs found in ${runsDir}.`;

  // Group by seller, average across scenarios/runs.
  const bySeller = new Map<string, GradeReport[]>();
  for (const r of rows) {
    const list = bySeller.get(r.sellerId) ?? [];
    list.push(r);
    bySeller.set(r.sellerId, list);
  }
  const avg = (ns: number[]) => Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10;

  const table = [...bySeller.entries()]
    .map(([seller, rs]) => ({
      seller,
      runs: rs.length,
      sqs: avg(rs.map((x) => x.saleQualityScore)),
      dvi: avg(rs.map((x) => x.dvi.total)),
      wins: rs.filter((x) => x.outcome === 'won').length,
      price: avg(rs.map((x) => x.priceIntegrity.score)),
      scenarios: [...new Set(rs.map((x) => x.scenarioId))].join(', '),
    }))
    .sort((a, b) => b.sqs - a.sqs);

  // Diagnostic layer: aggregate failure modes across all graded runs into
  // failure-modes.md / failure-modes.json alongside the leaderboard.
  const diag = writeFailureModeReports(runsDir);

  return [
    `# The Value Engine Benchmark — Leaderboard`,
    ``,
    `| # | Seller | Runs | Avg SQS | Avg DVI | Wins | Avg Price Integrity | Scenarios |`,
    `|---|---|---|---|---|---|---|---|`,
    ...table.map(
      (t, i) => `| ${i + 1} | \`${t.seller}\` | ${t.runs} | **${t.sqs}** | ${t.dvi} | ${t.wins}/${t.runs} | ${t.price} | ${t.scenarios} |`,
    ),
    ``,
    `SQS = 0.6×DVI + 20×price-integrity + outcome points (won 20 · no-decision 6 · lost 0).`,
    ``,
    ...(diag
      ? [`Failure-mode diagnostics: ${diag.runsWithModes}/${diag.runsTotal} graded runs carry failure-mode data → \`failure-modes.md\` / \`failure-modes.json\`.`, ``]
      : []),
  ].join('\n');
}
