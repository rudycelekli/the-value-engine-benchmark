#!/usr/bin/env python3
"""Render VEB paper figures from frozen data, and gate them against drift.

Reads datasets/veb-canonical-135/paper-stats.json (the frozen grid summary) and
emits publication figures into this directory. matplotlib only — no seaborn.
Every value plotted traces directly to paper-stats.json.

Figures:
  value_frontier.pdf        — mean SQS (y) vs cost-per-completed-deal (x, log).
  leaderboard_sqs.pdf       — per-model mean SQS, pooled over tracks.
  behavioral_fingerprint.pdf— pack-track EB attainment and MAP completion.
  failure_heatmap.pdf       — failure-mode incidence by difficulty tier.

Alongside the PDFs it writes figure-data.json: the exact values plotted, plus
the sha256 of each emitted PDF. That file is what makes figures auditable the
same way the generated TeX is. The prose and tables healed on the 11->13 model
regrid while the figures lagged precisely because figures sat outside the drift
gate; --check puts them inside it.

Usage:
  python3 paper/figures/render_figures.py            # render + refresh sidecar
  python3 paper/figures/render_figures.py --check    # verify, no matplotlib needed
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STATS_PATH = ROOT / "datasets" / "veb-canonical-135" / "paper-stats.json"
SIDECAR = HERE / "figure-data.json"

FIGURES = (
    "value_frontier.pdf",
    "leaderboard_sqs.pdf",
    "behavioral_fingerprint.pdf",
    "failure_heatmap.pdf",
)

# Muted, print-safe palette keyed by lab (matches the /benchmark page tone).
# moonshotai and thinkingmachines joined on the 13-model regrid; before this
# pass lab_of() fell through to the OpenAI teal and plotted them as OpenAI.
LAB_COLORS = {
    "anthropic": "#8e2a1e",   # brick
    "openai": "#1e6f8e",      # teal
    "google": "#4a6b2a",      # olive
    "xai": "#6b4a8e",         # violet
    "moonshot": "#b0692c",    # ochre
    "thinkingmachines": "#2e7d6b",  # pine
}
LAB_LABEL = {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "google": "Google",
    "xai": "xAI",
    "moonshot": "Moonshot AI †",
    "thinkingmachines": "Thinking Machines †",
}

# Keyed on the full endpoint id, vendor prefix included, so an open-weight
# endpoint can never fall through to a closed lab's colour by accident.
LAB_OF_PREFIX = (
    ("moonshotai/", "moonshot"),
    ("thinkingmachines/", "thinkingmachines"),
    ("claude", "anthropic"),
    ("gpt", "openai"),
    ("gemini", "google"),
    ("grok", "xai"),
)

# Same set the leaderboard table daggers; see analysis/gen-macros.py.
OPEN_WEIGHT = {"moonshotai/kimi-k3", "thinkingmachines/inkling"}


def lab_of(model: str) -> str:
    for prefix, lab in LAB_OF_PREFIX:
        if model.startswith(prefix):
            return lab
    raise KeyError(f"no lab mapping for endpoint {model!r} — add it to LAB_OF_PREFIX")


def display(model: str) -> str:
    """Tick label. Mirrors gen-macros.display(): bare endpoint, dagger if open."""
    bare = model.split("/")[-1]
    return f"{bare} †" if model in OPEN_WEIGHT else bare


def lab_handles(marker: str, size: float, labs) -> list:
    from matplotlib.lines import Line2D

    return [
        Line2D([0], [0], marker=marker, linestyle="none", markersize=size,
               markerfacecolor=LAB_COLORS[k], markeredgecolor="none", label=LAB_LABEL[k])
        for k in labs
    ]


# --------------------------------------------------------------------------
# Plotted values. Extracted once, shared by the renderer and the drift gate,
# so the sidecar can never describe a different slice than the figures do.
# --------------------------------------------------------------------------
def figure_data(stats: dict) -> dict:
    per_model = stats["per_model"]
    beh = stats["behavioral"]
    fm = stats["failure_modes"]
    tiers = ["easy", "mid", "hard"]

    frontier_order = sorted(per_model)
    lb_order = sorted(per_model, key=lambda m: per_model[m]["mean_sqs"])
    beh_order = sorted(beh, key=lambda m: beh[m]["eb_attended_pct"])

    return {
        "stats_sha256": hashlib.sha256(STATS_PATH.read_bytes()).hexdigest(),
        "roster_size": len(stats["roster"]),
        "value_frontier": {
            "frontier_members": sorted(stats["frontier"]["members"]),
            "points": [
                {"model": m, "lab": lab_of(m),
                 "cost_per_deal_usd": per_model[m]["cost_per_deal_usd"],
                 "mean_sqs": per_model[m]["mean_sqs"]}
                for m in frontier_order
            ],
        },
        "leaderboard_sqs": {
            "bars": [{"model": m, "lab": lab_of(m), "mean_sqs": per_model[m]["mean_sqs"]}
                     for m in lb_order],
        },
        "behavioral_fingerprint": {
            "bars": [{"model": m, "eb_attended_pct": beh[m]["eb_attended_pct"],
                      "map_pct": beh[m]["map_pct"]}
                     for m in beh_order],
        },
        "failure_heatmap": {
            "tiers": tiers,
            "modes": fm["modes"],
            "matrix": [[fm["by_tier"][t][mode] for t in tiers] for mode in fm["modes"]],
        },
    }


# --------------------------------------------------------------------------
# Renderers
# --------------------------------------------------------------------------
def render_value_frontier(data: dict) -> Path:
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D

    block = data["value_frontier"]
    frontier = set(block["frontier_members"])

    fig, ax = plt.subplots(figsize=(7.0, 4.6))
    for pt in block["points"]:
        x, y = pt["cost_per_deal_usd"], pt["mean_sqs"]
        color = LAB_COLORS[pt["lab"]]
        on_front = pt["model"] in frontier
        ax.scatter(
            x, y,
            s=190 if on_front else 90,
            c=color,
            edgecolors="#1a1714" if on_front else "none",
            linewidths=1.4 if on_front else 0,
            marker="*" if on_front else "o",
            zorder=3 if on_front else 2,
            alpha=0.95,
        )
        ax.annotate(display(pt["model"]), (x, y), textcoords="offset points",
                    xytext=(7, 4), fontsize=7.0, color="#3a332e")

    ax.set_xscale("log")
    ax.set_xlabel("Cost per completed deal (USD, log scale)", fontsize=9.5)
    ax.set_ylabel("Mean Sale-Quality Score", fontsize=9.5)
    ax.tick_params(labelsize=8)
    ax.grid(True, which="both", axis="both", color="#e6e0d8", linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    labs = sorted({p["lab"] for p in block["points"]}, key=list(LAB_COLORS).index)
    handles = lab_handles("o", 6, labs)
    handles.append(
        Line2D([0], [0], marker="*", linestyle="none", markersize=11,
               markerfacecolor="#8e2a1e", markeredgecolor="#1a1714",
               markeredgewidth=1.2, label="On the frontier")
    )
    ax.legend(handles=handles, fontsize=7.0, frameon=False, loc="lower right",
              handletextpad=0.4, borderaxespad=0.6)

    fig.tight_layout()
    out = HERE / "value_frontier.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def render_leaderboard_bar(data: dict) -> Path:
    """Horizontal bar of per-model mean SQS (pooled over tracks), lab-colored."""
    import matplotlib.pyplot as plt

    bars = data["leaderboard_sqs"]["bars"]
    models = [b["model"] for b in bars]
    vals = [b["mean_sqs"] for b in bars]
    colors = [LAB_COLORS[b["lab"]] for b in bars]

    fig, ax = plt.subplots(figsize=(7.0, 5.2))
    y = range(len(models))
    ax.barh(list(y), vals, color=colors, edgecolor="#1a1714", linewidth=0.5, zorder=3)
    for yi, v in zip(y, vals):
        ax.text(v + 0.4, yi, f"{v:.1f}", va="center", fontsize=7.5, color="#3a332e")
    ax.set_yticks(list(y))
    ax.set_yticklabels([display(m) for m in models], fontsize=8)
    ax.set_xlabel("Mean Sale-Quality Score (pooled over tracks)", fontsize=9.5)
    ax.set_xlim(0, max(vals) * 1.12)
    ax.tick_params(labelsize=8)
    ax.grid(True, axis="x", color="#e6e0d8", linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    labs = sorted({b["lab"] for b in bars}, key=list(LAB_COLORS).index)
    ax.legend(handles=lab_handles("s", 7, labs), fontsize=7.0, frameon=False,
              loc="lower right", handletextpad=0.4, borderaxespad=0.6)

    fig.tight_layout()
    out = HERE / "leaderboard_sqs.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def render_behavioral_fingerprint(data: dict) -> Path:
    """Paired bars per model (pack track): EB-attended rate and MAP completion.

    These are the process markers whose movement — not vocabulary adoption —
    the pack lift depends on. Sorted by EB attainment.
    """
    import matplotlib.pyplot as plt

    bars = data["behavioral_fingerprint"]["bars"]
    models = [b["model"] for b in bars]
    eb = [b["eb_attended_pct"] for b in bars]
    mp = [b["map_pct"] for b in bars]

    fig, ax = plt.subplots(figsize=(7.2, 5.4))
    y = list(range(len(models)))
    h = 0.38
    ax.barh([yi + h / 2 for yi in y], eb, height=h, color="#1e6f8e",
            edgecolor="#1a1714", linewidth=0.4,
            label="EB attended (conditional commitment)", zorder=3)
    ax.barh([yi - h / 2 for yi in y], mp, height=h, color="#c98a2b",
            edgecolor="#1a1714", linewidth=0.4, label="MAP dates confirmed", zorder=3)
    for yi, v in zip(y, eb):
        ax.text(v + 0.8, yi + h / 2, f"{v:.0f}", va="center", fontsize=6.6, color="#3a332e")
    for yi, v in zip(y, mp):
        ax.text(v + 0.8, yi - h / 2, f"{v:.0f}", va="center", fontsize=6.6, color="#3a332e")
    ax.set_yticks(y)
    ax.set_yticklabels([display(m) for m in models], fontsize=8)
    ax.set_xlabel("Percent of pack-track episodes", fontsize=9.5)
    ax.set_xlim(0, max(max(eb), max(mp)) * 1.15)
    ax.tick_params(labelsize=8)
    ax.grid(True, axis="x", color="#e6e0d8", linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.legend(fontsize=7.8, frameon=False, loc="lower right",
              handletextpad=0.4, borderaxespad=0.6)

    fig.tight_layout()
    out = HERE / "behavioral_fingerprint.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def render_failure_heatmap(data: dict) -> Path:
    """Heatmap of failure-mode incidence (rows) by difficulty tier (cols)."""
    import matplotlib.pyplot as plt

    block = data["failure_heatmap"]
    modes, tiers, matrix = block["modes"], block["tiers"], block["matrix"]
    label = {
        "no-pain-owner-identified": "No pain owner identified",
        "shallow-implication": "Shallow implication",
        "never-reached-eb": "Never reached EB",
        "meeting-waste": "Meeting waste",
        "discount-beyond-tolerance": "Discount beyond tolerance",
        "price-panic-under-procurement": "Price panic under procurement",
    }

    fig, ax = plt.subplots(figsize=(5.6, 4.4))
    im = ax.imshow(matrix, aspect="auto", cmap="YlOrRd", vmin=0, vmax=100)
    ax.set_xticks(range(len(tiers)))
    ax.set_xticklabels([t.capitalize() for t in tiers], fontsize=9)
    ax.set_yticks(range(len(modes)))
    ax.set_yticklabels([label[m] for m in modes], fontsize=8)
    for i in range(len(modes)):
        for j in range(len(tiers)):
            v = matrix[i][j]
            # One decimal: the prose quotes these to 0.1pp, and a heatmap that
            # rounded 72.3 to "72" is how the caption and the body drifted apart.
            ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=8,
                    color="#1a1714" if v < 60 else "white")
    ax.set_xlabel("Difficulty tier", fontsize=9.5)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Incidence (% of runs)", fontsize=8.5)
    cbar.ax.tick_params(labelsize=7.5)
    for spine in ax.spines.values():
        spine.set_visible(False)

    fig.tight_layout()
    out = HERE / "failure_heatmap.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------
def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_all(stats: dict) -> dict:
    # Pin the PDF CreationDate to the data's own timestamp. matplotlib honours
    # SOURCE_DATE_EPOCH; without it every render differs in one metadata string
    # and `git diff --exit-code` would fail on identical plots.
    generated_at = (stats.get("lineage") or {}).get("generated_at")
    if generated_at and "SOURCE_DATE_EPOCH" not in os.environ:
        epoch = datetime.strptime(generated_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
        os.environ["SOURCE_DATE_EPOCH"] = str(int(epoch.timestamp()))

    import matplotlib

    matplotlib.use("Agg")

    data = figure_data(stats)
    for fn in (render_value_frontier, render_leaderboard_bar,
               render_behavioral_fingerprint, render_failure_heatmap):
        out = fn(data)
        print(f"wrote {out.relative_to(ROOT)}")

    data["figures"] = {name: sha256_of(HERE / name) for name in FIGURES}
    SIDECAR.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {SIDECAR.relative_to(ROOT)}")
    return data


def check(stats: dict) -> int:
    """Drift gate. Stdlib only, so CI needs no plotting stack."""
    if not SIDECAR.exists():
        print(f"FAIL missing {SIDECAR.relative_to(ROOT)} — run render_figures.py", file=sys.stderr)
        return 1
    committed = json.loads(SIDECAR.read_text(encoding="utf-8"))
    recomputed = figure_data(stats)

    problems = []
    for key in sorted(recomputed):
        if committed.get(key) != recomputed[key]:
            problems.append(f"  figure-data.{key} is stale relative to paper-stats.json")
    for name, digest in (committed.get("figures") or {}).items():
        path = HERE / name
        if not path.exists():
            problems.append(f"  {name} is missing")
        elif sha256_of(path) != digest:
            problems.append(f"  {name} does not match the sha256 recorded in figure-data.json")

    if problems:
        print("FAIL figures are behind their data:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        print("  fix: python3 paper/figures/render_figures.py", file=sys.stderr)
        return 1
    print(f"OK figures match paper-stats.json ({recomputed['roster_size']} endpoints)")
    return 0


def main() -> None:
    stats = json.loads(STATS_PATH.read_text(encoding="utf-8"))
    if "--check" in sys.argv[1:]:
        sys.exit(check(stats))
    render_all(stats)


if __name__ == "__main__":
    main()
