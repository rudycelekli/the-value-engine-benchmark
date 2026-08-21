# Macro Provenance

Every result macro below is emitted solely from `datasets/veb-canonical-135/paper-stats.json`. No numbers are hand-entered. Re-run `python3 analysis/gen-macros.py` to regenerate.

## Lineage

- Generated from datasets/veb-canonical-135/paper-stats.json (sha256 d595ed77dd657abcf7c671c7f3142f71c97bc6919215b1c13df7db2737b692e3),
- produced 2026-08-21T01:36:38Z by analysis/analyze-canonical-135.py from:
-   - veb-canonical-135.jsonl (sha256 13a9e6e5ac7a638207423393d24153ac31b9d3b92fdb09a77783c83b2af98f05) — graded rollouts — every rubric, outcome and cost number
-   - portkey-full.jsonl.gz (sha256 43ae1dbf73773cabe206dda742b296559d28c8cbdb8ce4f4fb52f231e52d6f0d) — provider telemetry — latency_reliability block only

`analysis/verify_stats.py` checks that the digests above still match the files on disk, so a macro that predates the rows it claims to summarize fails the release gate.

The three latency/reliability macros (`resLatencyPfifty`, `resLatencyPninety`, `resReliability`) trace to the provider telemetry export listed above, not to the graded rollouts. That export is operational data and is not distributed, so those three numbers are **not reproducible from the released dataset** — every other macro is.

## Emitted Macros

| Macro | Value | Source field in paper-stats.json |
|---|---|---|
| `\resPackLiftOverall` | `2.6` | `paper-stats.pack_lift.cleared_rate_pp` |
| `\resBestModel` | `gpt-5.6-sol` | `paper-stats.best_model.model` |
| `\resBestModelSQS` | `72.5` | `paper-stats.best_model.mean_sqs` |
| `\resBestModelPackSQS` | `72.9` | `paper-stats.per_model_track[best].pack.mean_sqs` |
| `\resBestModelCleanPack` | `45.9` | `paper-stats.per_model_track[best].pack.cleared_rate_pct` |
| `\resMedianCleanPack` | `6.7` | `median over paper-stats.per_model_track[*].pack.cleared_rate_pct` |
| `\resRunnerUpPackSQS` | `68.9` | `paper-stats.per_model_track[gpt-5.5].pack.mean_sqs` |
| `\resFieldBandLo` | `51` | `floor(min paper-stats.per_model[*].mean_sqs excl. top two)` |
| `\resFieldBandHi` | `66` | `ceil(max paper-stats.per_model[*].mean_sqs excl. top two)` |
| `\resCellsComplete` | `3510` | `paper-stats.cells_graded` |
| `\resLiftEasy` | `4.1` | `paper-stats.tier_lift.easy.cleared_lift_pp` |
| `\resLiftMid` | `0.3` | `paper-stats.tier_lift.mid.cleared_lift_pp` |
| `\resLiftHard` | `2.8` | `paper-stats.tier_lift.hard.cleared_lift_pp` |
| `\resTierSQSEasy` | `63.3` | `paper-stats.tier_lift.easy.oob_sqs` |
| `\resTierSQSMid` | `57.0` | `paper-stats.tier_lift.mid.oob_sqs` |
| `\resTierSQSHard` | `54.4` | `paper-stats.tier_lift.hard.oob_sqs` |
| `\resTierCleanEasy` | `14.5` | `paper-stats.tier_lift.easy.oob_cleared_pct` |
| `\resTierCleanMid` | `3.8` | `paper-stats.tier_lift.mid.oob_cleared_pct` |
| `\resTierCleanHard` | `1.0` | `paper-stats.tier_lift.hard.oob_cleared_pct` |
| `\resSQSLiftPooled` | `$+$0.93` | `paper-stats.sqs_lift_paired.pooled.delta_sqs` |
| `\resSQSLiftEasy` | `$+$3.18` | `paper-stats.sqs_lift_paired.easy.delta_sqs` |
| `\resSQSLiftMid` | `$-$1.44` | `paper-stats.sqs_lift_paired.mid.delta_sqs` |
| `\resSQSLiftHard` | `$+$0.01` | `paper-stats.sqs_lift_paired.hard.delta_sqs` |
| `\resSQSCIPooled` | `[$+$0.07, $+$1.81]` | `paper-stats.sqs_lift_paired.pooled.ci95` |
| `\resSQSCIEasy` | `[$+$1.82, $+$4.54]` | `paper-stats.sqs_lift_paired.easy.ci95` |
| `\resSQSCIMid` | `[$-$2.81, $-$0.09]` | `paper-stats.sqs_lift_paired.mid.ci95` |
| `\resSQSCIHard` | `[$-$1.60, $+$1.67]` | `paper-stats.sqs_lift_paired.hard.ci95` |
| `\resEBOOB` | `28.4` | `paper-stats.tracks.oob.eb_attended_pct` |
| `\resEBPack` | `31.1` | `paper-stats.tracks.pack.eb_attended_pct` |
| `\resMAPOOB` | `43.6` | `paper-stats.tracks.oob.map_pct` |
| `\resMAPPack` | `44.2` | `paper-stats.tracks.pack.map_pct` |
| `\resPriceIntegrityOOB` | `0.716` | `paper-stats.tracks.oob.price_integrity` |
| `\resPriceIntegrityPack` | `0.687` | `paper-stats.tracks.pack.price_integrity` |
| `\resBestModelEB` | `71.9` | `paper-stats.behavioral[best].eb_attended_pct` |
| `\resBestModelMAP` | `64.4` | `paper-stats.behavioral[best].map_pct` |
| `\resWorstModelEB` | `5.2` | `paper-stats.behavioral[grok-4.3].eb_attended_pct` |
| `\resWorstModelMAP` | `22.0` | `paper-stats.behavioral[grok-4.3].map_pct` |
| `\resFlashCleanOOB` | `11.8` | `paper-stats.per_model_track[gemini-3.5-flash].oob.cleared_rate_pct` |
| `\resFlashDiscount` | `23.1` | `paper-stats.per_model[gemini-3.5-flash].mean_discount_pct` |
| `\resFlashPriceIntegrity` | `0.46` | `paper-stats.per_model[gemini-3.5-flash].mean_price_integrity` |
| `\resFablePackSQS` | `68.5` | `paper-stats.per_model_track[claude-fable-5].pack.mean_sqs` |
| `\resFableCleanOOB` | `0.7` | `paper-stats.per_model_track[claude-fable-5].oob.cleared_rate_pct` |
| `\resFableCleanPack` | `7.4` | `paper-stats.per_model_track[claude-fable-5].pack.cleared_rate_pct` |
| `\resSeedCells` | `234` | `paper-stats.seed_variance.cells` |
| `\resSeedMixedCells` | `101` | `paper-stats.seed_variance.mixed_cells` |
| `\resSeedMixedPct` | `43.2` | `paper-stats.seed_variance.mixed_pct` |
| `\resSeedIntraSD` | `12.1` | `paper-stats.seed_variance.mean_intra_cell_sqs_sd` |
| `\resDiscountOOB` | `10.5` | `paper-stats.tracks.oob.mean_discount_pct` |
| `\resDiscountPack` | `11.6` | `paper-stats.tracks.pack.mean_discount_pct` |
| `\resFrontierBest` | `gpt-5.6-sol` | `paper-stats.frontier.efficiency_leader` |
| `\resFrontierBestSQSPerUSD` | `30.5` | `paper-stats.frontier.sqs_per_usd_per_deal` |
| `\resCostPerDealMin` | `2.38` | `paper-stats.cost_per_deal.min` |
| `\resCostPerDealMax` | `579.66` | `paper-stats.cost_per_deal.max` |
| `\resCostPerDealSpread` | `244` | `paper-stats.cost_per_deal.max / .min` |
| `\resCostPerRunMin` | `0.30` | `paper-stats.cost_per_run.min` |
| `\resCostPerRunMax` | `23.62` | `paper-stats.cost_per_run.max` |
| `\resCostPerRunMinModel` | `inkling` | `argmin paper-stats.cost_per_run.by_model` |
| `\resCostPerRunMaxModel` | `claude-fable-5` | `argmax paper-stats.cost_per_run.by_model` |
| `\resCostPerRunSpread` | `78` | `paper-stats.cost_per_run.max / .min` |
| `\resFrontierBestCostPerRun` | `1.00` | `paper-stats.per_model[frontier.efficiency_leader].cost_per_run_usd` |
| `\resLatencyPfifty` | `5.8` | `paper-stats.latency_reliability.p50_s` |
| `\resLatencyPninety` | `14.3` | `paper-stats.latency_reliability.p90_s` |
| `\resReliability` | `92.4` | `paper-stats.latency_reliability.reliability_pct` |
| `\resFailNoPainOwnerOverall` | `85.8` | `paper-stats.failure_modes.overall.no-pain-owner-identified` |
| `\resFailNoPainOwnerEasy` | `77.8` | `paper-stats.failure_modes.by_tier.easy.no-pain-owner-identified` |
| `\resFailNoPainOwnerMid` | `90.8` | `paper-stats.failure_modes.by_tier.mid.no-pain-owner-identified` |
| `\resFailNoPainOwnerHard` | `94.4` | `paper-stats.failure_modes.by_tier.hard.no-pain-owner-identified` |
| `\resFailShallowImplicationOverall` | `74.7` | `paper-stats.failure_modes.overall.shallow-implication` |
| `\resFailShallowImplicationEasy` | `66.7` | `paper-stats.failure_modes.by_tier.easy.shallow-implication` |
| `\resFailShallowImplicationMid` | `80.2` | `paper-stats.failure_modes.by_tier.mid.shallow-implication` |
| `\resFailShallowImplicationHard` | `82.3` | `paper-stats.failure_modes.by_tier.hard.shallow-implication` |
| `\resFailNeverEBOverall` | `77.7` | `paper-stats.failure_modes.overall.never-reached-eb` |
| `\resFailNeverEBEasy` | `72.3` | `paper-stats.failure_modes.by_tier.easy.never-reached-eb` |
| `\resFailNeverEBMid` | `75.8` | `paper-stats.failure_modes.by_tier.mid.never-reached-eb` |
| `\resFailNeverEBHard` | `91.2` | `paper-stats.failure_modes.by_tier.hard.never-reached-eb` |
| `\resFailMeetingWasteOverall` | `59.7` | `paper-stats.failure_modes.overall.meeting-waste` |
| `\resFailMeetingWasteEasy` | `67.4` | `paper-stats.failure_modes.by_tier.easy.meeting-waste` |
| `\resFailMeetingWasteMid` | `55.7` | `paper-stats.failure_modes.by_tier.mid.meeting-waste` |
| `\resFailMeetingWasteHard` | `50.1` | `paper-stats.failure_modes.by_tier.hard.meeting-waste` |
| `\resFailDiscountBeyondOverall` | `54.8` | `paper-stats.failure_modes.overall.discount-beyond-tolerance` |
| `\resFailDiscountBeyondEasy` | `30.3` | `paper-stats.failure_modes.by_tier.easy.discount-beyond-tolerance` |
| `\resFailDiscountBeyondMid` | `77.2` | `paper-stats.failure_modes.by_tier.mid.discount-beyond-tolerance` |
| `\resFailDiscountBeyondHard` | `70.1` | `paper-stats.failure_modes.by_tier.hard.discount-beyond-tolerance` |
| `\resFailPricePanicOverall` | `40.4` | `paper-stats.failure_modes.overall.price-panic-under-procurement` |
| `\resFailPricePanicEasy` | `19.3` | `paper-stats.failure_modes.by_tier.easy.price-panic-under-procurement` |
| `\resFailPricePanicMid` | `72.6` | `paper-stats.failure_modes.by_tier.mid.price-panic-under-procurement` |
| `\resFailPricePanicHard` | `34.4` | `paper-stats.failure_modes.by_tier.hard.price-panic-under-procurement` |

## Deferred / not emitted here

The following macros are intentionally absent from `result-macros.tex`:

| Macro family | Reason |
|---|---|
| `resJudgeKappa`, `resJudgeAlpha` | Forthcoming — pre-registered study (Task 13/15); numbers not yet available and must not be fabricated. |
| `resHardened*` | Hardened-judge analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resDist*` | Score-distribution analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resPanel*` | Panel-calibration analysis not present in paper-stats.json; reconciled in Task 13/14. |
| `resPassBar`, `resEnrichRows` | Enrichment-coverage analysis not present in paper-stats.json; reconciled in Task 13/14. |
