#!/usr/bin/env python3
"""Compute all paper benchmark numbers from the validated packaged grid.

Source: datasets/veb-canonical-135/veb-canonical-135.jsonl  (3510 rows, authoritative)
Emits:  datasets/veb-canonical-135/paper-stats.json  + stdout summary

Every paper/benchmark-page number derives from THIS file only (per user directive).
Latency/reliability come from the Portkey export, rescoped to the roster present
in the source rows. Roster size and every grid dimension are derived from the
data, never hardcoded — the run aborts if they do not multiply out to the row
count.

Env overrides (for use by verify_stats.py and Task 7):
  VEB_ROWS       — path to the source JSONL (overrides SRC default)
  VEB_STATS_OUT  — path to write the output JSON (overrides OUT default)
  VEB_PORTKEY    — path to the provider telemetry export (overrides PORTKEY)
  VEB_ROWS_AS    — the name the source JSONL is *published* under, when that
                   differs from its local path. The internal export lives at
                   veb-canonical-135-plus540.jsonl but readers download the
                   identical bytes as veb-canonical-135.jsonl; recording the
                   published name keeps `source` referring to a file the reader
                   can actually obtain. The digest is unaffected — it is always
                   computed from the bytes actually read, so the name can never
                   drift away from the content it labels.
"""
import datetime
import hashlib
import json
import os
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_full = ROOT / "datasets" / "veb-canonical-135" / "veb-canonical-135.jsonl"
_preview = ROOT / "datasets" / "veb-canonical-135" / "veb-canonical-135-preview.jsonl"

if os.environ.get("VEB_ROWS"):
    SRC = Path(os.environ["VEB_ROWS"])
else:
    SRC = _full if _full.exists() else _preview

# The name readers see. Defaults to the local filename, so an unset override
# is always truthful; set it only when the local path is an internal export of
# bytes that are published under a different name.
SRC_NAME = os.environ.get("VEB_ROWS_AS") or SRC.name

if os.environ.get("VEB_STATS_OUT"):
    OUT = Path(os.environ["VEB_STATS_OUT"])
else:
    OUT = SRC.parent / "paper-stats.json"

if os.environ.get("VEB_PORTKEY"):
    PORTKEY = Path(os.environ["VEB_PORTKEY"])
else:
    PORTKEY = ROOT / "rollouts" / "_portkey-export" / "portkey-full.jsonl.gz"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_state():
    """Commit the generator ran from, and whether that tree was dirty.

    A dirty tree means the recorded sha does not identify the exact code that
    produced the numbers — record it rather than imply a clean provenance.
    """
    def run(*args):
        try:
            r = subprocess.run(["git", *args], cwd=str(ROOT),
                               capture_output=True, text=True)
            return r.stdout.strip() if r.returncode == 0 else None
        except OSError:
            return None

    sha = run("rev-parse", "HEAD")
    status = run("status", "--porcelain")
    return {"sha": sha, "dirty": bool(status) if status is not None else None}


def lineage(src: Path) -> dict:
    """Source lineage for the emitted stats.

    Without this a reader cannot tell which bytes a headline number was
    computed from, or whether the stats predate the rows they summarize.

    `sources` is explicit that this file has two inputs, not one: every rubric,
    cost and outcome number comes from the graded rollouts, but the
    latency_reliability block comes from a provider telemetry export that is
    NOT part of the release and therefore cannot be reproduced from it.
    """
    sources = [{
        "role": "graded rollouts — every rubric, outcome and cost number",
        "file": SRC_NAME,
        "sha256": sha256_file(src),
        "bytes": src.stat().st_size,
        "distribution": "out-of-band (see DATA.md); digest committed in-repo",
    }]
    telemetry = {
        "role": "provider telemetry — latency_reliability block only",
        "file": PORTKEY.name,
        "distribution": "not distributed — private operational export; this block "
                        "is not reproducible from the released dataset",
    }
    if PORTKEY.exists():
        telemetry["sha256"] = sha256_file(PORTKEY)
        telemetry["bytes"] = PORTKEY.stat().st_size
        telemetry["present_at_generation"] = True
    else:
        telemetry["present_at_generation"] = False
    sources.append(telemetry)

    return {
        "source_file": SRC_NAME,
        "source_sha256": sources[0]["sha256"],
        "source_bytes": sources[0]["bytes"],
        "sources": sources,
        "generator": "analysis/analyze-canonical-135.py",
        "generator_sha256": sha256_file(Path(__file__).resolve()),
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                                 .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "git": git_state(),
    }


def pct(vals, p):
    if not vals:
        return None
    v = sorted(vals)
    k = (len(v) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def main():
    # per (model, track) accumulators
    rows = []
    for line in SRC.open():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        g = r.get("grade") or {}
        model = (r.get("model") or {}).get("model")
        pack = bool((r.get("model") or {}).get("pack"))
        track = "pack" if pack else "oob"
        sqs = g.get("saleQualityScore")
        dvi = (g.get("dvi") or {}).get("total")
        pi = g.get("priceIntegrity") or {}
        eb = g.get("ebEngagement")
        rows.append({
            "model": model,
            "track": track,
            "sqs": sqs,
            "dvi": dvi,
            "outcome": g.get("outcome"),
            "cleared": bool(r.get("cleared_bar")),
            "discount": pi.get("discountGivenPct"),
            "price_score": pi.get("score"),
            "cost_usd": ((r.get("cost") or {}).get("usd")),
            "difficulty": (g.get("scenarioMeta") or {}).get("difficulty"),
            "scenario": (r.get("env") or {}).get("scenario_id"),
            "seed": r.get("seed"),
            "eb_attended": eb == "attended_with_conditional_commitment",
            "map_pct": g.get("mapDatesConfirmedPct"),
            "modes": [fm.get("modeId") for fm in (g.get("failureModes") or [])],
        })

    roster = sorted({r["model"] for r in rows})

    def subset(pred):
        return [r for r in rows if pred(r)]

    def won(r):
        return r["outcome"] == "won"

    # ---- per-model (pooled over tracks) ----
    per_model = {}
    for m in roster:
        mr = subset(lambda r, m=m: r["model"] == m)
        deals_won = sum(1 for r in mr if won(r))
        cost_total = sum(r["cost_usd"] for r in mr if isinstance(r["cost_usd"], (int, float)))
        per_model[m] = {
            "n": len(mr),
            "mean_sqs": round(mean([r["sqs"] for r in mr]), 2),
            "mean_dvi": round(mean([r["dvi"] for r in mr]), 2),
            "win_rate_pct": round(100 * deals_won / len(mr), 2),
            "cleared_rate_pct": round(100 * sum(1 for r in mr if r["cleared"]) / len(mr), 2),
            "mean_discount_pct": round(mean([r["discount"] for r in mr]), 3),
            "mean_price_integrity": round(mean([r["price_score"] for r in mr]), 3),
            "cost_total_usd": round(cost_total, 2),
            "deals_won": deals_won,
            "cost_per_deal_usd": round(cost_total / deals_won, 4) if deals_won else None,
            "cost_per_cleared_usd": round(cost_total / max(1, sum(1 for r in mr if r["cleared"])), 4),
            "cost_per_run_usd": round(cost_total / len(mr), 4) if mr else None,
        }

    # ---- per-model x per-track (the leaderboard table's cells) ----
    # The leaderboard was hand-maintained in tables/leaderboard.tex, so its cells
    # were literals that no generator owned -- and one of them disagreed with the
    # prose. Emitting the cells here lets the table be generated, which is the
    # only way "the paper matches its own dataset" is true by construction.
    # Both rates are reported because they are NOT the same quantity: `cleared`
    # is the machine-checked clean-win predicate (Section 3, win conditions) and
    # is a strict subset of `won` -- deals can close while failing the gate.
    per_model_track = {}
    for m in roster:
        per_model_track[m] = {}
        for t in ("oob", "pack"):
            tr = subset(lambda r, m=m, t=t: r["model"] == m and r["track"] == t)
            per_model_track[m][t] = {
                "n": len(tr),
                "mean_sqs": round(mean([r["sqs"] for r in tr]), 2),
                "win_rate_pct": round(100 * sum(1 for r in tr if won(r)) / len(tr), 2),
                "cleared_rate_pct": round(100 * sum(1 for r in tr if r["cleared"]) / len(tr), 2),
            }

    # ---- headline: best model by mean SQS ----
    best_model = max(roster, key=lambda m: per_model[m]["mean_sqs"])

    # ---- pack lift (pooled) ----
    def track_stats(track):
        tr = subset(lambda r: r["track"] == track)
        return {
            "n": len(tr),
            "mean_sqs": round(mean([r["sqs"] for r in tr]), 2),
            "win_rate_pct": round(100 * sum(1 for r in tr if won(r)) / len(tr), 2),
            "cleared_rate_pct": round(100 * sum(1 for r in tr if r["cleared"]) / len(tr), 2),
            "mean_discount_pct": round(mean([r["discount"] for r in tr]), 3),
            # Process markers pooled per track. Section 7.2 narrates the pack's
            # mechanism as a rise in EB engagement and MAP completion against a
            # slight loss of price discipline; those three pairs were typed.
            "eb_attended_pct": round(100 * sum(1 for r in tr if r["eb_attended"]) / len(tr), 1),
            "map_pct": round(mean([r["map_pct"] for r in tr]), 1),
            "price_integrity": round(mean([r["price_score"] for r in tr]), 3),
        }
    oob, packt = track_stats("oob"), track_stats("pack")
    # Differenced from the unrounded means, not from the rounded values above:
    # subtracting two already-rounded means gave 0.94 while the paired bootstrap
    # over the identical rows gave 0.93, and a reader comparing the two tables
    # would read that purely presentational gap as a methodological one.
    _sqs = {t: mean([r["sqs"] for r in rows if r["track"] == t]) for t in ("oob", "pack")}
    pack_lift = {
        "sqs_points": round(_sqs["pack"] - _sqs["oob"], 2),
        "win_rate_pp": round(packt["win_rate_pct"] - oob["win_rate_pct"], 2),
        "cleared_rate_pp": round(packt["cleared_rate_pct"] - oob["cleared_rate_pct"], 2),
    }

    # ---- per-tier lift (difficulty 1=easy,2=mid,3=hard) ----
    tier_lift = {}
    for tier, name in [(1, "easy"), (2, "mid"), (3, "hard")]:
        o = subset(lambda r, t=tier: r["difficulty"] == t and r["track"] == "oob")
        p = subset(lambda r, t=tier: r["difficulty"] == t and r["track"] == "pack")
        if o and p:
            tier_lift[name] = {
                "oob_sqs": round(mean([r["sqs"] for r in o]), 2),
                "pack_sqs": round(mean([r["sqs"] for r in p]), 2),
                "sqs_lift": round(mean([r["sqs"] for r in p]) - mean([r["sqs"] for r in o]), 2),
                "oob_win_pct": round(100 * sum(1 for r in o if won(r)) / len(o), 2),
                "pack_win_pct": round(100 * sum(1 for r in p if won(r)) / len(p), 2),
                "win_lift_pp": round(100 * sum(1 for r in p if won(r)) / len(p)
                                     - 100 * sum(1 for r in o if won(r)) / len(o), 2),
                # The paper reports "clean-win rate" throughout, which is the
                # `cleared` gate (Section 3), not raw `won`. Emitting the cleared
                # series alongside keeps the two distinguishable instead of
                # letting prose silently pick one and the table the other.
                "oob_cleared_pct": round(100 * sum(1 for r in o if r["cleared"]) / len(o), 2),
                "pack_cleared_pct": round(100 * sum(1 for r in p if r["cleared"]) / len(p), 2),
                "cleared_lift_pp": round(100 * sum(1 for r in p if r["cleared"]) / len(p)
                                         - 100 * sum(1 for r in o if r["cleared"]) / len(o), 2),
            }

    # ---- cost per deal spread across roster ----
    cpd = {m: per_model[m]["cost_per_deal_usd"] for m in roster if per_model[m]["cost_per_deal_usd"]}
    cost_per_deal_min = min(cpd.values()) if cpd else None
    cost_per_deal_max = max(cpd.values()) if cpd else None

    # ---- cost per run (denominator-free) across roster ----
    cpr = {m: per_model[m]["cost_per_run_usd"] for m in roster if per_model[m]["cost_per_run_usd"]}
    cost_per_run_min = min(cpr.values()) if cpr else None
    cost_per_run_max = max(cpr.values()) if cpr else None

    # ---- Value Frontier: mean SQS (max) vs cost-per-deal (min) ----
    # a model is dominated if another has >= SQS and <= cost-per-deal (strict on one)
    pts = {m: (per_model[m]["mean_sqs"], per_model[m]["cost_per_deal_usd"]) for m in roster
           if per_model[m]["cost_per_deal_usd"]}
    frontier = []
    for m, (q, c) in pts.items():
        dominated = any((qq >= q and cc <= c) and (qq > q or cc < c)
                        for mm, (qq, cc) in pts.items() if mm != m)
        if not dominated:
            frontier.append(m)
    # efficiency leader = best SQS per USD-per-deal (SQS points per dollar)
    eff = {m: per_model[m]["mean_sqs"] / per_model[m]["cost_per_deal_usd"]
           for m in roster if per_model[m]["cost_per_deal_usd"]}
    frontier_best = max(eff, key=eff.get) if eff else None

    # ---- behavioral fingerprint per model (pack track) ----
    # EB-attended rate, MAP-completion mean, price-integrity mean — the process
    # markers the analysis narrative decomposes. Pack track = methodology-on.
    behavioral = {}
    for m in roster:
        mp = subset(lambda r, m=m: r["model"] == m and r["track"] == "pack")
        behavioral[m] = {
            "eb_attended_pct": round(100 * sum(1 for r in mp if r["eb_attended"]) / len(mp), 1),
            "map_pct": round(mean([r["map_pct"] for r in mp]), 1),
            "price_integrity": round(mean([r["price_score"] for r in mp]), 3),
        }

    # ---- failure-mode incidence by difficulty tier ----
    # fraction of runs (both tracks) exhibiting each mode, per tier — the
    # diagnostic gradient in the failure heatmap.
    heat_modes = [
        "no-pain-owner-identified", "shallow-implication", "never-reached-eb",
        "meeting-waste", "discount-beyond-tolerance", "price-panic-under-procurement",
    ]
    failure_modes = {"modes": heat_modes, "by_tier": {}}
    # Pooled incidence over the whole grid. Section 8.1 quoted these two headline
    # rates as typed literals carried over from the retired 2,970-cell grid, so
    # they drifted from the dataset they describe once the grid moved. Derived
    # here so the prose is fed by the same pass that builds the heatmap.
    failure_modes["overall"] = {
        mode: round(100 * sum(1 for r in rows if mode in r["modes"]) / len(rows), 1)
        for mode in heat_modes
    }
    for tier, name in [(1, "easy"), (2, "mid"), (3, "hard")]:
        tr = subset(lambda r, t=tier: r["difficulty"] == t)
        n_t = len(tr)
        failure_modes["by_tier"][name] = {
            mode: round(100 * sum(1 for r in tr if mode in r["modes"]) / n_t, 1)
            for mode in heat_modes
        } if n_t else {}

    # ---- seed-matched paired bootstrap on Delta SQS ----
    # Section 8.4 promises the headline lift is a *within-pair* contrast (same
    # model, scenario and seed; pack vs OOB) via a seeded paired bootstrap, never
    # a difference of independent means. The point estimates and CIs in
    # tables/lift.tex were typed from an earlier grid, so the table asserted a
    # protocol the paper described but no longer re-ran. Implemented here with the
    # same deterministic LCG as src/stats/bootstrap.ts, so both pipelines agree.
    BOOT_ITERS, BOOT_SEED = 5000, 42

    def _rng(seed):
        s = seed & 0xFFFFFFFF

        def nxt():
            nonlocal s
            s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
            return s / 0x100000000
        return nxt

    def paired_ci(pairs):
        """Percentile 95% CI on the mean within-pair difference (pack - oob)."""
        if not pairs:
            return None
        rnd = _rng(BOOT_SEED)
        n = len(pairs)
        means = []
        for _ in range(BOOT_ITERS):
            total = 0.0
            for _ in range(n):
                a, b = pairs[int(rnd() * n)]
                total += a - b
            means.append(total / n)
        means.sort()
        return [round(means[int(BOOT_ITERS * 0.025)], 2),
                round(means[int(BOOT_ITERS * 0.975) - 1], 2)]

    # Pair on (model, scenario, seed) — the shared label that makes pairing valid.
    paired = {}
    for r in rows:
        paired.setdefault((r["model"], r["scenario"], r["seed"]), {})[r["track"]] = r
    pairs_by_tier = {"easy": [], "mid": [], "hard": [], "pooled": []}
    tier_name = {1: "easy", 2: "mid", 3: "hard"}
    for key, tt in paired.items():
        if "oob" not in tt or "pack" not in tt:
            continue
        d = (tt["pack"]["sqs"], tt["oob"]["sqs"])
        pairs_by_tier["pooled"].append(d)
        name = tier_name.get(tt["oob"]["difficulty"])
        if name:
            pairs_by_tier[name].append(d)
    sqs_lift = {
        k: {
            "pairs": len(v),
            "delta_sqs": round(mean([a - b for a, b in v]), 2),
            "ci95": paired_ci(v),
        }
        for k, v in pairs_by_tier.items()
    }
    for k, v in sqs_lift.items():
        ci = v["ci95"]
        v["significant"] = bool(ci and (ci[0] > 0 or ci[1] < 0))

    # ---- seed variance: within-cell decisiveness of buyer stochasticity ----
    # A "cell" holds model, scenario and track fixed and varies only the buyer
    # seed. A cell that contains both a clean win and a non-win is a bundle of
    # seed-matched preference pairs -- the artifact that justifies the seed depth.
    # Section 8.3 quoted "90 of 198 cells", a count fixed to the retired 11-model
    # roster; derived here it tracks the roster automatically.
    cells = {}
    for r in rows:
        cells.setdefault((r["model"], r["scenario"], r["track"]), []).append(r)
    mixed = sum(1 for v in cells.values()
                if any(x["cleared"] for x in v) and not all(x["cleared"] for x in v))
    intra_sd = [statistics.stdev([x["sqs"] for x in v]) for v in cells.values() if len(v) > 1]
    seed_variance = {
        "cells": len(cells),
        "mixed_cells": mixed,
        "mixed_pct": round(100 * mixed / len(cells), 1),
        "mean_intra_cell_sqs_sd": round(mean(intra_sd), 1),
    }

    # ---- latency/reliability from Portkey, rescoped to roster ----
    # map roster bare names -> portkey raw model field (same bare names)
    roster_set = set(roster)
    lat = []
    ok = n = 0
    if PORTKEY.exists():
        for line in PORTKEY.open():
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            rm = (r.get("request") or {}).get("model") or (r.get("response") or {}).get("model")
            if rm not in roster_set:
                continue
            st = (r.get("response_details") or {}).get("status")
            good = isinstance(st, int) and 200 <= st < 300
            n += 1
            ok += 1 if good else 0
            rt = r.get("response_time")
            if isinstance(rt, (int, float)):
                lat.append(rt)
    latency = {
        "scope": f"{len(roster)}-model roster (gpt-5.5-pro excluded)",
        "n_calls": n,
        "reliability_pct": round(100 * ok / n, 2) if n else None,
        "p50_s": round(pct(lat, 50) / 1000, 2) if lat else None,
        "p90_s": round(pct(lat, 90) / 1000, 2) if lat else None,
        "p95_s": round(pct(lat, 95) / 1000, 2) if lat else None,
    }

    # ---- grid, derived from the rows themselves ----
    # Every dimension comes from the data so the published grid can never
    # describe a shape the dataset does not have. The assertion below is what
    # makes "3,510 = 13 x 9 x 15 x 2" a checked fact rather than a claim.
    n_scenarios = len({r["scenario"] for r in rows})
    n_seeds = len({r["seed"] for r in rows})
    n_tracks = len({r["track"] for r in rows})
    grid = {
        "scenarios": n_scenarios,
        "seeds": n_seeds,
        "models": len(roster),
        "tracks": n_tracks,
        "per_model_per_track": n_scenarios * n_seeds,
        "per_model": n_scenarios * n_seeds * n_tracks,
    }
    product = grid["models"] * grid["scenarios"] * grid["seeds"] * grid["tracks"]
    if product != len(rows):
        raise SystemExit(
            f"grid inconsistency: {grid['models']} models x {grid['scenarios']} scenarios x "
            f"{grid['seeds']} seeds x {grid['tracks']} tracks = {product}, "
            f"but the source has {len(rows)} rows"
        )

    result = {
        "source": SRC_NAME,
        "lineage": lineage(SRC),
        "rows": len(rows),
        "roster": roster,
        "grid": grid,
        "cells_graded": len(rows),
        "per_model": per_model,
        "per_model_track": per_model_track,
        "best_model": {"model": best_model, "mean_sqs": per_model[best_model]["mean_sqs"]},
        "tracks": {"oob": oob, "pack": packt},
        "pack_lift": pack_lift,
        "tier_lift": tier_lift,
        "cost_per_deal": {"min": cost_per_deal_min, "max": cost_per_deal_max, "by_model": cpd},
        "cost_per_run": {"min": cost_per_run_min, "max": cost_per_run_max, "by_model": cpr},
        "frontier": {"members": frontier, "efficiency_leader": frontier_best,
                     "sqs_per_usd_per_deal": round(eff[frontier_best], 3) if frontier_best else None},
        "behavioral": behavioral,
        "failure_modes": failure_modes,
        "sqs_lift_paired": sqs_lift,
        "seed_variance": seed_variance,
        "latency_reliability": latency,
    }
    OUT.write_text(json.dumps(result, indent=2))

    # ---- stdout ----
    print(f"rows={len(rows)}  roster={len(roster)}  cells_graded={len(rows)}")
    print("\n== per-model (pooled over tracks) ==")
    hdr = f"{'model':<26}{'n':>5}{'SQS':>7}{'DVI':>7}{'win%':>7}{'clr%':>7}{'disc%':>7}{'$/deal':>9}"
    print(hdr); print("-" * len(hdr))
    for m in sorted(roster, key=lambda m: -per_model[m]["mean_sqs"]):
        s = per_model[m]
        print(f"{m:<26}{s['n']:>5}{s['mean_sqs']:>7.1f}{s['mean_dvi']:>7.1f}{s['win_rate_pct']:>7.1f}"
              f"{s['cleared_rate_pct']:>7.1f}{s['mean_discount_pct']:>7.2f}"
              f"{(s['cost_per_deal_usd'] or 0):>9.2f}")
    print(f"\nbest model (mean SQS): {best_model} = {per_model[best_model]['mean_sqs']}")
    print(f"pack lift: SQS {pack_lift['sqs_points']:+} pts | win-rate {pack_lift['win_rate_pp']:+} pp | cleared {pack_lift['cleared_rate_pp']:+} pp")
    print(f"  OOB: SQS={oob['mean_sqs']} win%={oob['win_rate_pct']} disc%={oob['mean_discount_pct']}")
    print(f"  PACK: SQS={packt['mean_sqs']} win%={packt['win_rate_pct']} disc%={packt['mean_discount_pct']}")
    print("per-tier SQS lift:")
    for name, t in tier_lift.items():
        print(f"  {name:<5} oob={t['oob_sqs']} pack={t['pack_sqs']} lift={t['sqs_lift']:+} ({t['win_lift_pp']:+}pp win)")
    print(f"cost/deal: min={cost_per_deal_min} max={cost_per_deal_max}")
    print(f"frontier members: {frontier}")
    print(f"efficiency leader: {frontier_best} @ {result['frontier']['sqs_per_usd_per_deal']} SQS/$/deal")
    print(f"latency(roster): p50={latency['p50_s']}s p90={latency['p90_s']}s reliability={latency['reliability_pct']}%  (n={latency['n_calls']})")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
