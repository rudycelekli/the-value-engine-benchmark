/** VEB-Buy grade report rendering (markdown + JSON) — mirror of report.ts. */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BQS_WEIGHTS } from './bqs.js';
import { BUYER_CATEGORY_ORDER, type DetectedBuyerFailure } from './buyer-taxonomy.js';
import type { BuyerGradeReport } from './buyer-judge.js';

export function writeBuyerGradeReport(runDir: string, report: BuyerGradeReport): void {
  writeFileSync(join(runDir, 'grade.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(runDir, 'grade.md'), buyerGradeMarkdown(report));
}

export function buyerGradeMarkdown(r: BuyerGradeReport): string {
  const { ledger, bqs } = r;
  const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a');
  const check = (b: boolean): string => (b ? '✓' : '✗');

  return [
    `# VEB-Buy Grade Report — ${r.scenarioId} · \`${r.buyerId}\``,
    ``,
    `Graded ${r.gradedAt} · judge: **${r.judge}**${r.pack ? ` · pack: ${r.pack}` : ''}`,
    ``,
    `## Headline`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **Buyer Quality Score** | **${bqs.bqs} / 100** |`,
    `| **Decision** | ${r.decision} vs ground truth **${r.rightAnswer}** — ${bqs.decisionCorrect ? 'RIGHT' : '**WRONG**'} |`,
    `| Price | ${ledger.pricePaid !== undefined ? `paid ${ledger.pricePaid}` : 'no purchase'} (ZOPA: floor ${ledger.sellerFloor} · list ${ledger.listPrice} · ceiling ${ledger.budgetCeiling}) |`,
    ``,
    `## BQS breakdown`,
    ``,
    `| Component | Weight | Score 0–100 | Weighted |`,
    `|---|---|---|---|`,
    `| Decision Quality | ${BQS_WEIGHTS.decisionQuality} | ${bqs.components.decisionQuality} | ${round1(BQS_WEIGHTS.decisionQuality * bqs.components.decisionQuality)} |`,
    `| Surplus Capture | ${BQS_WEIGHTS.surplusCapture} | ${bqs.components.surplusCapture} | ${round1(BQS_WEIGHTS.surplusCapture * bqs.components.surplusCapture)} |`,
    `| Diligence Coverage | ${BQS_WEIGHTS.diligenceCoverage} | ${bqs.components.diligenceCoverage} | ${round1(BQS_WEIGHTS.diligenceCoverage * bqs.components.diligenceCoverage)} |`,
    `| Process Discipline | ${BQS_WEIGHTS.processDiscipline} | ${bqs.components.processDiscipline} | ${round1(BQS_WEIGHTS.processDiscipline * bqs.components.processDiscipline)} |`,
    ``,
    `Process checklist: ${check(bqs.processChecklist.competitiveProcess)} competitive process · ${check(bqs.processChecklist.batnaBeforeNegotiation)} BATNA before negotiating · ${check(bqs.processChecklist.stakeholderAlignment)} own-stakeholder alignment · ${check(bqs.processChecklist.nonPriceTermsAddressed)} non-price terms`,
    ``,
    `## Claims & landmine ledger`,
    ``,
    `| | Count | Coverage |`,
    `|---|---|---|`,
    `| Suspect claims tested | ${ledger.claimsSuspectTested} / ${ledger.claimsSuspectTotal} | ${pct(ledger.claimsSuspectTested, ledger.claimsSuspectTotal)} |`,
    `| Landmines discovered | ${ledger.landminesDiscovered} / ${ledger.landminesPlanted} | ${pct(ledger.landminesDiscovered, ledger.landminesPlanted)} |`,
    `| Reference calls | ${ledger.referenceCallsMade} | |`,
    `| POC | ${ledger.pocRun ? 'run' : ledger.pocAvailable ? '**available, skipped**' : 'not available'} | |`,
    `| Contract terms raised | ${check(ledger.contractTermsRaised)} | |`,
    `| Competitive quotes | ${ledger.competitiveQuotesObtained} | |`,
    `| Vendor tactics | deadline: ${ledger.deadlineTacticFired ? `fired${ledger.boughtInsideDeadlineWindow ? ' — **bought inside the window**' : ''}` : '—'} · scarcity: ${ledger.scarcityTacticFired ? 'fired' : '—'} | |`,
    ``,
    ...regretSection(r),
    ...failureModesSection(r),
    `## Notes`,
    ``,
    ...r.notes.map((n) => `- ${n}`),
    ``,
  ].join('\n');
}

/** Counterfactual regret (docs/COUNTERFACTUAL-REGRET.md) — diagnostic, not part of BQS. */
function regretSection(r: BuyerGradeReport): string[] {
  const reg = r.regret;
  if (!reg) return [];
  const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
  if (!reg.scored) {
    return [
      `## Regret`,
      ``,
      `*Not scored — walk-right scenario. Punishing a bad buy here is Decision Quality's job; dollars of "surplus" against a deal that should not exist are not meaningful.*`,
      ``,
    ];
  }
  const pctOfOracle = reg.oracleBuyerSurplus > 0
    ? ` (${Math.round((reg.totalRegret / reg.oracleBuyerSurplus) * 100)}% of oracle)`
    : '';
  const lines = [
    `## Regret (counterfactual, diagnostic — not in BQS)`,
    ``,
    `| | Dollars |`,
    `|---|---|`,
    `| Oracle buyer surplus | ${usd(reg.oracleBuyerSurplus)} |`,
    `| Realized utility | ${usd(reg.realizedUtility)} |`,
    `| **Total regret** | **${usd(reg.totalRegret)}**${pctOfOracle} |`,
    `| — price (money never unlocked) | ${usd(reg.priceRegret)} |`,
    `| — trade (wrong package signed) | ${usd(reg.tradeRegret)} |`,
    `| — decision (surplus foregone) | ${usd(reg.decisionRegret)} |`,
  ];
  if (reg.largestDrop) {
    lines.push(
      ``,
      `Largest single ceiling drop: **${usd(reg.largestDrop.drop)}** at turn ${reg.largestDrop.turn} (transcript #${reg.largestDrop.transcriptIndex}) — the move that destroyed the most value.`,
    );
  }
  lines.push(``);
  return lines;
}

/** Failure-mode section — grouped by category, severity-tagged, evidence shown. */
function failureModesSection(r: BuyerGradeReport): string[] {
  const modes = r.failureModes;
  if (modes.length === 0) return [`## Buyer failure modes`, ``, `*None detected — a clean buy.*`, ``];

  const sev = (d: DetectedBuyerFailure) => (d.severity === 'critical' ? '**CRITICAL**' : d.severity);
  const evLine = (e: DetectedBuyerFailure['evidence'][number]) => {
    const loc = [e.week !== undefined && `wk${e.week}`, e.turnIndex !== undefined && `t${e.turnIndex}`].filter(Boolean).join(' ');
    return `  - ${loc ? `[${loc}] ` : ''}${e.detail}${e.quote ? ` — "${e.quote}"` : ''}`;
  };

  const lines: string[] = [
    `## Buyer failure modes`,
    ``,
    `${modes.length} mode(s) detected (deterministic ledger pass + ${r.judge} judge; judge modes carry transcript citations).`,
    ``,
  ];
  for (const cat of BUYER_CATEGORY_ORDER) {
    const inCat = modes.filter((m) => m.category === cat);
    if (!inCat.length) continue;
    lines.push(`### ${cat}`, ``);
    for (const m of inCat) {
      lines.push(`- **${m.label}** \`${m.modeId}\` — ${sev(m)} · ${m.source}${m.penalizedByDefault ? '' : ' · *(tracked, not penalized)*'}`);
      lines.push(...m.evidence.map(evLine));
    }
    lines.push(``);
  }
  return lines;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
