# Macro Provenance

Every result macro below is emitted solely from `datasets/veb-canonical-135/paper-stats.json`. No numbers are hand-entered. Re-run `python3 analysis/gen-macros.py` to regenerate.

## Lineage

- Generated from datasets/veb-canonical-135/paper-stats.json (sha256 1ba709865f7e8b25f69c6c8d9ac040835c591a5edbb8e43f824860d47b38dff4),
- produced 2026-08-20T21:20:06Z by analysis/analyze-canonical-135.py from:
-   - veb-canonical-135.jsonl (sha256 00d8bec5bb78e926b6ec083cf82526c81cee29ea22d4b3ff0e4c6cb9cbbb0ab3) — graded rollouts — every rubric, outcome and cost number
-   - portkey-full.jsonl.gz (sha256 43ae1dbf73773cabe206dda742b296559d28c8cbdb8ce4f4fb52f231e52d6f0d) — provider telemetry — latency_reliability block only

`analysis/verify_stats.py` checks that the digests above still match the files on disk, so a macro that predates the rows it claims to summarize fails the release gate.

The three latency/reliability macros (`resLatencyPfifty`, `resLatencyPninety`, `resReliability`) trace to the provider telemetry export listed above, not to the graded rollouts. That export is operational data and is not distributed, so those three numbers are **not reproducible from the released dataset** — every other macro is.

## Emitted Macros

| Macro | Value | Source field in paper-stats.json |
|---|---|---|
| `\resPackLiftOverall` | `3.0` | `paper-stats.pack_lift.win_rate_pp` |
| `\resBestModel` | `gpt-5.6-sol` | `paper-stats.best_model.model` |
| `\resBestModelSQS` | `72.5` | `paper-stats.best_model.mean_sqs` |
| `\resCellsComplete` | `2970` | `paper-stats.cells_graded` |
| `\resLiftEasy` | `5.0` | `paper-stats.tier_lift.easy.win_lift_pp` |
| `\resLiftMid` | `0.2` | `paper-stats.tier_lift.mid.win_lift_pp` |
| `\resLiftHard` | `3.3` | `paper-stats.tier_lift.hard.win_lift_pp` |
| `\resDiscountOOB` | `11.2` | `paper-stats.tracks.oob.mean_discount_pct` |
| `\resDiscountPack` | `11.8` | `paper-stats.tracks.pack.mean_discount_pct` |
| `\resFrontierBest` | `gpt-5.6-sol` | `paper-stats.frontier.efficiency_leader` |
| `\resFrontierBestSQSPerUSD` | `30.5` | `paper-stats.frontier.sqs_per_usd_per_deal` |
| `\resCostPerDealMin` | `2.38` | `paper-stats.cost_per_deal.min` |
| `\resCostPerDealMax` | `579.66` | `paper-stats.cost_per_deal.max` |
| `\resLatencyPfifty` | `5.8` | `paper-stats.latency_reliability.p50_s` |
| `\resLatencyPninety` | `14.3` | `paper-stats.latency_reliability.p90_s` |
| `\resReliability` | `92.4` | `paper-stats.latency_reliability.reliability_pct` |

## Deferred / not emitted here

The following macros are intentionally absent from `result-macros.tex`:

| Macro family | Reason |
|---|---|
| `resJudgeKappa`, `resJudgeAlpha` | Forthcoming — pre-registered study (Task 13/15); numbers not yet available and must not be fabricated. |
| `resHardened*` | Hardened-judge analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resDist*` | Score-distribution analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resPanel*` | Panel-calibration analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resPassBar`, `resEnrichRows` | Enrichment-coverage analysis not present in paper-stats.json; reconciled in Task 13/14. |
