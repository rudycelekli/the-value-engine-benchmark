#!/usr/bin/env python3
"""Emit paper/result-macros.tex + paper/macros-provenance.md from paper-stats.json.
Single source of truth: no hand-entered result numbers."""
import hashlib, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
STATS_PATH = ROOT / "datasets/veb-canonical-135/paper-stats.json"
STATS = json.loads(STATS_PATH.read_text())

# Lineage is copied from paper-stats.json rather than sampled from the clock, so
# regenerating this file on unchanged inputs is byte-identical (CI enforces that
# with `git diff --exit-code`). It answers: which rows produced these numbers,
# and when — without which a macro is just an unsourced number in the paper.
_LIN = STATS.get("lineage") or {}
STATS_SHA = hashlib.sha256(STATS_PATH.read_bytes()).hexdigest()
LINEAGE_LINES = [
    f"Generated from datasets/veb-canonical-135/paper-stats.json (sha256 {STATS_SHA}),",
    f"produced {_LIN.get('generated_at', 'unknown')} by {_LIN.get('generator', 'unknown')} from:",
]
for _s in (_LIN.get("sources") or []):
    LINEAGE_LINES.append(
        f"  - {_s.get('file', 'unknown')} (sha256 {_s.get('sha256', 'not recorded')})"
        f" — {_s.get('role', '')}"
    )


def g(*path):
    d = STATS
    for k in path:
        d = d[k]
    return d


BEST = g("best_model", "model")


def sgn(x, dp=2):
    """LaTeX-ready signed number: bootstrap CIs and deltas read as +x / -x."""
    return f"{x:+.{dp}f}".replace("-", "$-$").replace("+", "$+$")


def field_band():
    """SQS band the field compresses into once the top two are set aside.

    Section 7.1 and the leaderboard figure caption both describe this band. It
    was typed as "50--65" against the 11-model roster; claude-fable-5 sits at
    65.9 on the 13-model board, so the typed upper edge had quietly become
    false. Rounded outward so the band always contains every model in it.
    """
    import math
    vals = sorted((g("per_model")[m]["mean_sqs"] for m in g("roster")), reverse=True)
    rest = vals[2:]
    return math.floor(min(rest)), math.ceil(max(rest))


def median_pack_cleared():
    """Median model's pack-track clean-win rate — the leader's comparison base."""
    vals = sorted(g("per_model_track")[m]["pack"]["cleared_rate_pct"] for m in g("roster"))
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2


# The paper says "clean-win rate" throughout, and Section 3 defines a clean win as
# the machine-checked `cleared_bar` gate (price held, EB reached, MAP confirmed) —
# a strict subset of `outcome == "won"`. Every rate macro below is therefore fed
# from the *cleared* series. Before this pass the prose used `cleared` in some
# places and the leaderboard table used raw `won` in others, which is how
# gemini-3.5-flash could be 11.9% in Section 7 and 12.59% in Table 1: not a typo,
# two different quantities wearing the same label.
MACROS = [
    ("resPackLiftOverall",      f'{g("pack_lift","cleared_rate_pp"):.1f}',          "paper-stats.pack_lift.cleared_rate_pp"),
    ("resBestModel",            BEST,                                                "paper-stats.best_model.model"),
    ("resBestModelSQS",         f'{g("best_model","mean_sqs"):.1f}',                "paper-stats.best_model.mean_sqs"),
    ("resBestModelPackSQS",     f'{g("per_model_track")[BEST]["pack"]["mean_sqs"]:.1f}',      "paper-stats.per_model_track[best].pack.mean_sqs"),
    ("resBestModelCleanPack",   f'{g("per_model_track")[BEST]["pack"]["cleared_rate_pct"]:.1f}', "paper-stats.per_model_track[best].pack.cleared_rate_pct"),
    ("resMedianCleanPack",      f'{median_pack_cleared():.1f}',                      "median over paper-stats.per_model_track[*].pack.cleared_rate_pct"),
    ("resRunnerUpPackSQS",      f'{g("per_model_track")["gpt-5.5"]["pack"]["mean_sqs"]:.1f}', "paper-stats.per_model_track[gpt-5.5].pack.mean_sqs"),
    ("resFieldBandLo",          str(field_band()[0]),                               "floor(min paper-stats.per_model[*].mean_sqs excl. top two)"),
    ("resFieldBandHi",          str(field_band()[1]),                               "ceil(max paper-stats.per_model[*].mean_sqs excl. top two)"),
    ("resCellsComplete",        str(g("cells_graded")),                             "paper-stats.cells_graded"),
    ("resLiftEasy",             f'{g("tier_lift","easy","cleared_lift_pp"):.1f}',   "paper-stats.tier_lift.easy.cleared_lift_pp"),
    ("resLiftMid",              f'{g("tier_lift","mid","cleared_lift_pp"):.1f}',    "paper-stats.tier_lift.mid.cleared_lift_pp"),
    ("resLiftHard",             f'{g("tier_lift","hard","cleared_lift_pp"):.1f}',   "paper-stats.tier_lift.hard.cleared_lift_pp"),
    # --- difficulty calibration series (Section 8.2) ---
    ("resTierSQSEasy",          f'{g("tier_lift","easy","oob_sqs"):.1f}',           "paper-stats.tier_lift.easy.oob_sqs"),
    ("resTierSQSMid",           f'{g("tier_lift","mid","oob_sqs"):.1f}',            "paper-stats.tier_lift.mid.oob_sqs"),
    ("resTierSQSHard",          f'{g("tier_lift","hard","oob_sqs"):.1f}',           "paper-stats.tier_lift.hard.oob_sqs"),
    ("resTierCleanEasy",        f'{g("tier_lift","easy","oob_cleared_pct"):.1f}',   "paper-stats.tier_lift.easy.oob_cleared_pct"),
    ("resTierCleanMid",         f'{g("tier_lift","mid","oob_cleared_pct"):.1f}',    "paper-stats.tier_lift.mid.oob_cleared_pct"),
    ("resTierCleanHard",        f'{g("tier_lift","hard","oob_cleared_pct"):.1f}',   "paper-stats.tier_lift.hard.oob_cleared_pct"),
    # --- paired bootstrap on Delta SQS (Section 7.2, Table 2) ---
    ("resSQSLiftPooled",        sgn(g("sqs_lift_paired","pooled","delta_sqs")),     "paper-stats.sqs_lift_paired.pooled.delta_sqs"),
    ("resSQSLiftEasy",          sgn(g("sqs_lift_paired","easy","delta_sqs")),       "paper-stats.sqs_lift_paired.easy.delta_sqs"),
    ("resSQSLiftMid",           sgn(g("sqs_lift_paired","mid","delta_sqs")),        "paper-stats.sqs_lift_paired.mid.delta_sqs"),
    ("resSQSLiftHard",          sgn(g("sqs_lift_paired","hard","delta_sqs")),       "paper-stats.sqs_lift_paired.hard.delta_sqs"),
    ("resSQSCIPooled",          f'[{sgn(g("sqs_lift_paired","pooled","ci95")[0])}, {sgn(g("sqs_lift_paired","pooled","ci95")[1])}]', "paper-stats.sqs_lift_paired.pooled.ci95"),
    ("resSQSCIEasy",            f'[{sgn(g("sqs_lift_paired","easy","ci95")[0])}, {sgn(g("sqs_lift_paired","easy","ci95")[1])}]',     "paper-stats.sqs_lift_paired.easy.ci95"),
    ("resSQSCIMid",             f'[{sgn(g("sqs_lift_paired","mid","ci95")[0])}, {sgn(g("sqs_lift_paired","mid","ci95")[1])}]',       "paper-stats.sqs_lift_paired.mid.ci95"),
    ("resSQSCIHard",            f'[{sgn(g("sqs_lift_paired","hard","ci95")[0])}, {sgn(g("sqs_lift_paired","hard","ci95")[1])}]',     "paper-stats.sqs_lift_paired.hard.ci95"),
    # --- process markers, pooled per track (Section 7.2) ---
    ("resEBOOB",                f'{g("tracks","oob","eb_attended_pct"):.1f}',       "paper-stats.tracks.oob.eb_attended_pct"),
    ("resEBPack",               f'{g("tracks","pack","eb_attended_pct"):.1f}',      "paper-stats.tracks.pack.eb_attended_pct"),
    ("resMAPOOB",               f'{g("tracks","oob","map_pct"):.1f}',               "paper-stats.tracks.oob.map_pct"),
    ("resMAPPack",              f'{g("tracks","pack","map_pct"):.1f}',              "paper-stats.tracks.pack.map_pct"),
    ("resPriceIntegrityOOB",    f'{g("tracks","oob","price_integrity"):.3f}',       "paper-stats.tracks.oob.price_integrity"),
    ("resPriceIntegrityPack",   f'{g("tracks","pack","price_integrity"):.3f}',      "paper-stats.tracks.pack.price_integrity"),
    ("resBestModelEB",          f'{g("behavioral")[BEST]["eb_attended_pct"]:.1f}',  "paper-stats.behavioral[best].eb_attended_pct"),
    ("resBestModelMAP",         f'{g("behavioral")[BEST]["map_pct"]:.1f}',          "paper-stats.behavioral[best].map_pct"),
    ("resWorstModelEB",         f'{g("behavioral")["grok-4.3"]["eb_attended_pct"]:.1f}', "paper-stats.behavioral[grok-4.3].eb_attended_pct"),
    ("resWorstModelMAP",        f'{g("behavioral")["grok-4.3"]["map_pct"]:.1f}',    "paper-stats.behavioral[grok-4.3].map_pct"),
    # --- the SQS/win-rate inversion (Section 7.1) ---
    ("resFlashCleanOOB",        f'{g("per_model_track")["gemini-3.5-flash"]["oob"]["cleared_rate_pct"]:.1f}', "paper-stats.per_model_track[gemini-3.5-flash].oob.cleared_rate_pct"),
    ("resFlashDiscount",        f'{g("per_model")["gemini-3.5-flash"]["mean_discount_pct"]:.1f}',   "paper-stats.per_model[gemini-3.5-flash].mean_discount_pct"),
    ("resFlashPriceIntegrity",  f'{g("per_model")["gemini-3.5-flash"]["mean_price_integrity"]:.2f}',"paper-stats.per_model[gemini-3.5-flash].mean_price_integrity"),
    ("resFablePackSQS",         f'{g("per_model_track")["claude-fable-5"]["pack"]["mean_sqs"]:.1f}',        "paper-stats.per_model_track[claude-fable-5].pack.mean_sqs"),
    ("resFableCleanOOB",        f'{g("per_model_track")["claude-fable-5"]["oob"]["cleared_rate_pct"]:.1f}', "paper-stats.per_model_track[claude-fable-5].oob.cleared_rate_pct"),
    ("resFableCleanPack",       f'{g("per_model_track")["claude-fable-5"]["pack"]["cleared_rate_pct"]:.1f}',"paper-stats.per_model_track[claude-fable-5].pack.cleared_rate_pct"),
    # --- seed variance (Section 8.3) ---
    ("resSeedCells",            str(g("seed_variance","cells")),                    "paper-stats.seed_variance.cells"),
    ("resSeedMixedCells",       str(g("seed_variance","mixed_cells")),              "paper-stats.seed_variance.mixed_cells"),
    ("resSeedMixedPct",         f'{g("seed_variance","mixed_pct"):.1f}',            "paper-stats.seed_variance.mixed_pct"),
    ("resSeedIntraSD",          f'{g("seed_variance","mean_intra_cell_sqs_sd"):.1f}',"paper-stats.seed_variance.mean_intra_cell_sqs_sd"),
    ("resDiscountOOB",          f'{g("tracks","oob","mean_discount_pct"):.1f}',     "paper-stats.tracks.oob.mean_discount_pct"),
    ("resDiscountPack",         f'{g("tracks","pack","mean_discount_pct"):.1f}',    "paper-stats.tracks.pack.mean_discount_pct"),
    ("resFrontierBest",         g("frontier","efficiency_leader"),                   "paper-stats.frontier.efficiency_leader"),
    ("resFrontierBestSQSPerUSD",f'{g("frontier","sqs_per_usd_per_deal"):.1f}',      "paper-stats.frontier.sqs_per_usd_per_deal"),
    ("resCostPerDealMin",       f'{g("cost_per_deal","min"):.2f}',                  "paper-stats.cost_per_deal.min"),
    ("resCostPerDealMax",       f'{g("cost_per_deal","max"):.2f}',                  "paper-stats.cost_per_deal.max"),
    # The abstract, Section 8.5 and the frontier caption each typed the per-deal
    # spread as ">200x". True, but hand-rounded in three places, which is the
    # same failure shape as the cost-per-run endpoints below.
    ("resCostPerDealSpread",    f'{g("cost_per_deal","max") / g("cost_per_deal","min"):.0f}', "paper-stats.cost_per_deal.max / .min"),
    # Cost-per-run endpoints were typed and named the wrong cheapest model: the
    # floor moved to an open-weight endpoint when the two open arms landed, and
    # the quoted spread was computed before that.
    ("resCostPerRunMin",        f'{g("cost_per_run","min"):.2f}',                   "paper-stats.cost_per_run.min"),
    ("resCostPerRunMax",        f'{g("cost_per_run","max"):.2f}',                   "paper-stats.cost_per_run.max"),
    ("resCostPerRunMinModel",   min(g("cost_per_run","by_model"), key=g("cost_per_run","by_model").get).split("/")[-1], "argmin paper-stats.cost_per_run.by_model"),
    ("resCostPerRunMaxModel",   max(g("cost_per_run","by_model"), key=g("cost_per_run","by_model").get).split("/")[-1], "argmax paper-stats.cost_per_run.by_model"),
    ("resCostPerRunSpread",     f'{g("cost_per_run","max") / g("cost_per_run","min"):.0f}', "paper-stats.cost_per_run.max / .min"),
    ("resFrontierBestCostPerRun", f'{g("per_model")[g("frontier","efficiency_leader")]["cost_per_run_usd"]:.2f}', "paper-stats.per_model[frontier.efficiency_leader].cost_per_run_usd"),
    ("resLatencyPfifty",        f'{g("latency_reliability","p50_s"):.1f}',          "paper-stats.latency_reliability.p50_s"),
    ("resLatencyPninety",       f'{g("latency_reliability","p90_s"):.1f}',          "paper-stats.latency_reliability.p90_s"),
    ("resReliability",          f'{g("latency_reliability","reliability_pct"):.1f}',"paper-stats.latency_reliability.reliability_pct"),
]

# --- failure-mode incidence, pooled and per tier (Section 8.1) ---
# Emitted as a family rather than one-offs: Section 8.1 quotes fourteen of these
# twenty-four cells in prose, and every one of them was a typed literal inherited
# from the retired 11-model grid. Naming them mechanically from the mode ids means
# a future mode added to the analyzer shows up here without anyone remembering to.
FAIL_MACRO = {
    "no-pain-owner-identified": "NoPainOwner",
    "shallow-implication": "ShallowImplication",
    "never-reached-eb": "NeverEB",
    "meeting-waste": "MeetingWaste",
    "discount-beyond-tolerance": "DiscountBeyond",
    "price-panic-under-procurement": "PricePanic",
}
for _mode, _label in FAIL_MACRO.items():
    for _scope, _key in [("Overall", None), ("Easy", "easy"), ("Mid", "mid"), ("Hard", "hard")]:
        _v = (g("failure_modes", "overall")[_mode] if _key is None
              else g("failure_modes", "by_tier")[_key][_mode])
        _src = ("paper-stats.failure_modes.overall." + _mode if _key is None
                else f"paper-stats.failure_modes.by_tier.{_key}.{_mode}")
        MACROS.append((f"resFail{_label}{_scope}", f"{_v:.1f}", _src))

# --- emit result-macros.tex ---
tex_lines = ["% AUTO-GENERATED by analysis/gen-macros.py — do not hand-edit.\n"]
tex_lines += [f"% {line}\n" for line in LINEAGE_LINES]
for name, val, _ in MACROS:
    tex_lines.append(f"\\newcommand{{\\{name}}}{{{val}}}\n")
tex_path = ROOT / "paper/result-macros.tex"
tex_path.write_text("".join(tex_lines))

# --- emit tables/leaderboard.tex ---
# Previously hand-maintained. Its Win% cells were raw `won` while its caption and
# the surrounding prose said "clean-win rate", so the table and Section 7.1
# disagreed about gemini-3.5-flash by 0.74pp. Generated here, the cells are the
# same `cleared` series the prose quotes, by construction.
OPEN_WEIGHT = {"moonshotai/kimi-k3", "thinkingmachines/inkling"}
PMT = g("per_model_track")


def display(m):
    """Roster keys carry a vendor prefix for the open-weight endpoints; the table
    shows the bare endpoint name and marks provenance with a dagger instead."""
    bare = m.split("/")[-1]
    return f"{bare}$^\\dagger$" if m in OPEN_WEIGHT else bare


lb_rows = sorted(g("roster"), key=lambda m: -PMT[m]["pack"]["mean_sqs"])
lb = [
    "% AUTO-GENERATED by analysis/gen-macros.py — do not hand-edit.\n",
    "\\begin{table}[t]\n  \\centering\n",
    "  \\caption{VEB leaderboard: mean Sale Quality Score (SQS, 0--100) and clean-win\n",
    "  rate (\\%) per model, pooled across all 9 scenarios and 15 seeds (135 instances\n",
    "  per model per track), for the out-of-box (OOB) and methodology-pack tracks.\n",
    "  Clean-win rate is the machine-checked gate of Section~\\ref{sec:wincond}, not raw\n",
    "  deal closure: a deal that closes on a discount beyond tolerance is a win but\n",
    "  not a clean win. Rows are sorted by pack-track SQS. The frontier leader\n",
    f"  (\\textbf{{{display(BEST)}}}) is bold; the two open-weight endpoints\n",
    "  (kimi-k3, inkling) are daggered ($\\dagger$).}\n",
    "  \\label{tab:leaderboard}\n",
    "  \\begin{tabular}{lcccc}\n    \\toprule\n",
    "    & \\multicolumn{2}{c}{OOB} & \\multicolumn{2}{c}{Pack} \\\\\n",
    "    \\cmidrule(lr){2-3}\\cmidrule(lr){4-5}\n",
    "    Model & SQS & Clean-win\\% & SQS & Clean-win\\% \\\\\n    \\midrule\n",
]
for m in lb_rows:
    o, p = PMT[m]["oob"], PMT[m]["pack"]
    cells = [f'{o["mean_sqs"]:.2f}', f'{o["cleared_rate_pct"]:.2f}',
             f'{p["mean_sqs"]:.2f}', f'{p["cleared_rate_pct"]:.2f}']
    name = display(m)
    if m == BEST:
        name = f"\\textbf{{{name}}}"
        cells = [f"\\textbf{{{c}}}" for c in cells]
    lb.append(f'    {name:<28}& ' + " & ".join(f"{c:>6}" for c in cells) + " \\\\\n")
lb += ["    \\bottomrule\n  \\end{tabular}\n\\end{table}\n"]
(ROOT / "paper/tables/leaderboard.tex").write_text("".join(lb))

# --- emit tables/lift.tex ---
# The Delta-SQS column and its CIs were typed from an earlier grid, so the table
# asserted a bootstrap that had not been re-run against the rows it labels.
SL, TL = g("sqs_lift_paired"), g("tier_lift")
lift = [
    "% AUTO-GENERATED by analysis/gen-macros.py — do not hand-edit.\n",
    "\\begin{table}[t]\n  \\centering\n",
    "  \\caption{Methodology lift: paired OOB$\\to$pack change in clean-win rate and mean\n",
    "  SQS, by difficulty tier, with the model held fixed and seeds shared. Positive\n",
    "  values indicate the methodology pack improved outcomes. The 95\\% CI is a\n",
    "  seed-matched paired bootstrap (5{,}000 resamples) on $\\Delta$SQS; intervals that\n",
    "  exclude zero are boldface. Lift is real but modest and concentrated in the easy\n",
    "  tier: the pack helps most where the deal is winnable, and does not rescue\n",
    "  structurally hard deals.}\n",
    "  \\label{tab:lift}\n",
    "  \\begin{tabular}{lcccc}\n    \\toprule\n",
    "    Tier & Pairs & $\\Delta$Clean-win\\% & $\\Delta$SQS & 95\\% CI on $\\Delta$SQS \\\\\n    \\midrule\n",
]
for key, label, macro in [("easy", "Easy (d1)", "\\resLiftEasy{}"),
                          ("mid", "Mid (d2)", "\\resLiftMid{}"),
                          ("hard", "Hard (d3)", "\\resLiftHard{}"),
                          ("pooled", "Pooled", "\\resPackLiftOverall{}")]:
    s = SL[key]
    ci = f"[{sgn(s['ci95'][0])}, {sgn(s['ci95'][1])}]"
    if s["significant"]:
        ci = f"\\textbf{{{ci}}}"
    if key == "pooled":
        lift.append("    \\midrule\n")
    lift.append(f"    {label:<10}& {s['pairs']:>5} & {macro:<24}"
                f"& {sgn(s['delta_sqs'])} & {ci} \\\\\n")
lift += ["    \\bottomrule\n  \\end{tabular}\n\\end{table}\n"]
(ROOT / "paper/tables/lift.tex").write_text("".join(lift))

# --- emit macros-provenance.md ---
prov_lines = [
    "# Macro Provenance\n\n",
    "Every result macro below is emitted solely from `datasets/veb-canonical-135/paper-stats.json`.",
    " No numbers are hand-entered. Re-run `python3 analysis/gen-macros.py` to regenerate.\n\n",
    "## Lineage\n\n",
    *[f"- {line}\n" for line in LINEAGE_LINES],
    "\n`analysis/verify_stats.py` checks that the digests above still match the"
    " files on disk, so a macro that predates the rows it claims to summarize"
    " fails the release gate.\n\n",
    "The three latency/reliability macros (`resLatencyPfifty`, `resLatencyPninety`,"
    " `resReliability`) trace to the provider telemetry export listed above, not to"
    " the graded rollouts. That export is operational data and is not distributed,"
    " so those three numbers are **not reproducible from the released dataset** —"
    " every other macro is.\n\n",
    "## Emitted Macros\n\n",
    "| Macro | Value | Source field in paper-stats.json |\n",
    "|---|---|---|\n",
]
for name, val, src in MACROS:
    prov_lines.append(f"| `\\{name}` | `{val}` | `{src}` |\n")

prov_lines += [
    "\n## Deferred / not emitted here\n\n",
    "The following macros are intentionally absent from `result-macros.tex`:\n\n",
    "| Macro family | Reason |\n",
    "|---|---|\n",
    "| `resJudgeKappa`, `resJudgeAlpha` | Forthcoming — pre-registered study (Task 13/15); numbers not yet available and must not be fabricated. |\n",
    "| `resHardened*` | Hardened-judge analysis not present in paper-stats.json; reconciled in Task 13/14. |\n",
    "| `resDist*` | Score-distribution analysis not present in paper-stats.json; reconciled in Task 13/14. |\n",
    "| `resPanel*` | Panel-calibration analysis not present in paper-stats.json; reconciled in Task 13/14. |\n",
    "| `resPassBar`, `resEnrichRows` | Enrichment-coverage analysis not present in paper-stats.json; reconciled in Task 13/14. |\n",
]
prov_path = ROOT / "paper/macros-provenance.md"
prov_path.write_text("".join(prov_lines))

print(f"wrote {len(MACROS)} macros")
