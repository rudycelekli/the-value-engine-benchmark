# Macro Provenance

Every result macro below is emitted solely from `datasets/veb-canonical-135/paper-stats.json`. No numbers are hand-entered. Re-run `python3 analysis/gen-macros.py` to regenerate.

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
