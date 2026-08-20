#!/usr/bin/env python3
"""Render VEB paper figures from frozen data.

Reads benchmark/exports/veb-canonical-135/paper-stats.json (the frozen grid
summary) and emits publication figures into this directory. matplotlib only —
no seaborn. Every value plotted traces directly to paper-stats.json.

Figures:
  value_frontier.pdf  — mean SQS (y) vs cost-per-completed-deal (x, log) per
                        model; the non-dominated model(s) form the front.

Usage:  python3 docs/paper/figures/render_figures.py
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

HERE = Path(__file__).resolve().parent
STATS = HERE.parents[2] / "benchmark" / "exports" / "veb-canonical-135" / "paper-stats.json"

# Muted, print-safe palette keyed by lab prefix (matches the /benchmark page tone).
LAB_COLORS = {
    "claude": "#8e2a1e",   # anthropic — brick
    "gpt": "#1e6f8e",      # openai — teal
    "gemini": "#4a6b2a",   # google — olive
    "grok": "#6b4a8e",     # xai — violet
}
LAB_LABEL = {
    "claude": "Anthropic",
    "gpt": "OpenAI",
    "gemini": "Google",
    "grok": "xAI",
}


def lab_of(model: str) -> str:
    for prefix in LAB_COLORS:
        if model.startswith(prefix):
            return prefix
    return "grok" if model.startswith("grok") else "gpt"


def render_value_frontier(stats: dict) -> Path:
    per_model = stats["per_model"]
    frontier = set(stats["frontier"]["members"])

    fig, ax = plt.subplots(figsize=(7.0, 4.6))

    for model, row in per_model.items():
        x = row["cost_per_deal_usd"]
        y = row["mean_sqs"]
        lab = lab_of(model)
        color = LAB_COLORS[lab]
        on_front = model in frontier
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
        # Label: nudge to avoid overlapping the marker.
        ax.annotate(
            model,
            (x, y),
            textcoords="offset points",
            xytext=(7, 4),
            fontsize=7.0,
            color="#3a332e",
        )

    ax.set_xscale("log")
    ax.set_xlabel("Cost per completed deal (USD, log scale)", fontsize=9.5)
    ax.set_ylabel("Mean Sale-Quality Score", fontsize=9.5)
    ax.tick_params(labelsize=8)
    ax.grid(True, which="both", axis="both", color="#e6e0d8", linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    # Legend: labs + frontier marker.
    handles = [
        Line2D([0], [0], marker="o", linestyle="none", markersize=6,
               markerfacecolor=LAB_COLORS[k], markeredgecolor="none", label=LAB_LABEL[k])
        for k in LAB_COLORS
    ]
    handles.append(
        Line2D([0], [0], marker="*", linestyle="none", markersize=11,
               markerfacecolor="#8e2a1e", markeredgecolor="#1a1714",
               markeredgewidth=1.2, label="On the frontier")
    )
    ax.legend(handles=handles, fontsize=7.5, frameon=False, loc="lower right",
              handletextpad=0.4, borderaxespad=0.6)

    fig.tight_layout()
    out = HERE / "value_frontier.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def render_leaderboard_bar(stats: dict) -> Path:
    """Horizontal bar of per-model mean SQS (pooled over tracks), lab-colored."""
    per_model = stats["per_model"]
    order = sorted(per_model.items(), key=lambda kv: kv[1]["mean_sqs"])
    models = [m for m, _ in order]
    vals = [row["mean_sqs"] for _, row in order]
    colors = [LAB_COLORS[lab_of(m)] for m in models]

    fig, ax = plt.subplots(figsize=(7.0, 4.8))
    y = range(len(models))
    ax.barh(list(y), vals, color=colors, edgecolor="#1a1714", linewidth=0.5, zorder=3)
    for yi, v in zip(y, vals):
        ax.text(v + 0.4, yi, f"{v:.1f}", va="center", fontsize=7.5, color="#3a332e")
    ax.set_yticks(list(y))
    ax.set_yticklabels(models, fontsize=8)
    ax.set_xlabel("Mean Sale-Quality Score (pooled over tracks)", fontsize=9.5)
    ax.set_xlim(0, max(vals) * 1.12)
    ax.tick_params(labelsize=8)
    ax.grid(True, axis="x", color="#e6e0d8", linewidth=0.6, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    handles = [
        Line2D([0], [0], marker="s", linestyle="none", markersize=7,
               markerfacecolor=LAB_COLORS[k], markeredgecolor="none", label=LAB_LABEL[k])
        for k in LAB_COLORS
    ]
    ax.legend(handles=handles, fontsize=7.5, frameon=False, loc="lower right",
              handletextpad=0.4, borderaxespad=0.6)

    fig.tight_layout()
    out = HERE / "leaderboard_sqs.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def render_behavioral_fingerprint(stats: dict) -> Path:
    """Paired bars per model (pack track): EB-attended rate and MAP completion.

    These are the process markers whose movement — not vocabulary adoption —
    the pack lift depends on. Sorted by EB attainment.
    """
    beh = stats["behavioral"]
    order = sorted(beh.items(), key=lambda kv: kv[1]["eb_attended_pct"])
    models = [m for m, _ in order]
    eb = [row["eb_attended_pct"] for _, row in order]
    mp = [row["map_pct"] for _, row in order]

    fig, ax = plt.subplots(figsize=(7.2, 5.0))
    y = list(range(len(models)))
    h = 0.38
    ax.barh([yi + h / 2 for yi in y], eb, height=h, color="#1e6f8e",
            edgecolor="#1a1714", linewidth=0.4, label="EB attended (conditional commitment)", zorder=3)
    ax.barh([yi - h / 2 for yi in y], mp, height=h, color="#c98a2b",
            edgecolor="#1a1714", linewidth=0.4, label="MAP dates confirmed", zorder=3)
    for yi, v in zip(y, eb):
        ax.text(v + 0.8, yi + h / 2, f"{v:.0f}", va="center", fontsize=6.6, color="#3a332e")
    for yi, v in zip(y, mp):
        ax.text(v + 0.8, yi - h / 2, f"{v:.0f}", va="center", fontsize=6.6, color="#3a332e")
    ax.set_yticks(y)
    ax.set_yticklabels(models, fontsize=8)
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


def render_failure_heatmap(stats: dict) -> Path:
    """Heatmap of failure-mode incidence (rows) by difficulty tier (cols)."""
    fm = stats["failure_modes"]
    modes = fm["modes"]
    tiers = ["easy", "mid", "hard"]
    label = {
        "no-pain-owner-identified": "No pain owner identified",
        "shallow-implication": "Shallow implication",
        "never-reached-eb": "Never reached EB",
        "meeting-waste": "Meeting waste",
        "discount-beyond-tolerance": "Discount beyond tolerance",
        "price-panic-under-procurement": "Price panic under procurement",
    }
    matrix = [[fm["by_tier"][t][mode] for t in tiers] for mode in modes]

    fig, ax = plt.subplots(figsize=(5.6, 4.4))
    im = ax.imshow(matrix, aspect="auto", cmap="YlOrRd", vmin=0, vmax=100)
    ax.set_xticks(range(len(tiers)))
    ax.set_xticklabels([t.capitalize() for t in tiers], fontsize=9)
    ax.set_yticks(range(len(modes)))
    ax.set_yticklabels([label[m] for m in modes], fontsize=8)
    for i, mode in enumerate(modes):
        for j in range(len(tiers)):
            v = matrix[i][j]
            ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=8,
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


def main() -> None:
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    outs = [
        render_value_frontier(stats),
        render_leaderboard_bar(stats),
        render_behavioral_fingerprint(stats),
        render_failure_heatmap(stats),
    ]
    for out in outs:
        print(f"wrote {out.relative_to(HERE.parents[2])}")


if __name__ == "__main__":
    main()
