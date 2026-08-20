#!/usr/bin/env python3
"""Evaluate a fine-tuned seller (kimi-k3 FT arm) through the real VEB environment.

This driver constructs and optionally executes the environment rollout command,
parses SQS from the output, and prints the OOB->FT SQS lift.

GUARDS:
  - A real (non-mock) run requires: a trained model checkpoint, valid provider API
    keys, and dist/cli.js built (run `npm run build` in the repo root first).
  - Do NOT fabricate SQS values. This script computes the delta at run time from
    actual environment rollout output.
  - Training (the compute-gated step) is OUT OF SCOPE for this scaffold.

Usage (mock/offline, no keys needed):
  python3 finetune/eval.py --mock

Usage (real run, after training is complete):
  python3 finetune/eval.py --ft-model <trained-model-id> --no-mock --oob-baseline <sqs>
"""

import argparse
import json
import pathlib
import subprocess
import sys
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "finetune" / "config.kimi-k3.json"


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def get_scenario_ids(config):
    """Read scenario IDs from the canonical preview JSONL."""
    preview = ROOT / config["data"]["canonical_preview_path"]
    ids = set()
    with open(preview) as f:
        for line in f:
            line = line.strip()
            if line:
                row = json.loads(line)
                sid = row.get("env", {}).get("scenario_id")
                if sid:
                    ids.add(sid)
    return sorted(ids)


def build_rollout_command(scenarios, seller_spec, seeds, pack, mock):
    """Construct the env rollout CLI command (verified entrypoint: node dist/cli.js)."""
    cmd = [
        "node", "dist/cli.js", "env", "rollout",
        "--scenarios", ",".join(scenarios),
        "--sellers", seller_spec,
        "--seeds", str(seeds),
    ]
    if pack:
        cmd.append("--pack")
    if mock:
        cmd.append("--mock")
    return cmd


def parse_sqs_from_output(text):
    """
    Parse saleQualityScore values from CLI JSON output.
    Looks for lines containing JSON objects with a saleQualityScore field.
    Returns a list of floats, or empty list if none found.
    """
    scores = []
    # Try to find JSON objects in the output (one per line or embedded)
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            sqs = None
            # Top-level
            if "saleQualityScore" in obj:
                sqs = obj["saleQualityScore"]
            # Nested under grade
            elif "grade" in obj and isinstance(obj["grade"], dict):
                sqs = obj["grade"].get("saleQualityScore")
            if sqs is not None:
                scores.append(float(sqs))
        except (json.JSONDecodeError, TypeError, ValueError):
            # Try regex fallback for embedded values
            for m in re.finditer(r'"saleQualityScore"\s*:\s*([0-9.]+)', line):
                scores.append(float(m.group(1)))
    return scores


def main():
    ap = argparse.ArgumentParser(
        description="Run FT seller through VEB env and compute OOB->FT SQS lift."
    )
    ap.add_argument(
        "--ft-model", default="kimi-k3-ft",
        help="Fine-tuned model spec/id to evaluate (default: kimi-k3-ft)."
    )
    ap.add_argument(
        "--oob-baseline", type=float, default=None,
        help=(
            "OOB baseline SQS mean (0-100 scale) to compute lift against. "
            "If not provided, uses config value or prints delta as N/A."
        )
    )
    ap.add_argument(
        "--seeds", type=int, default=None,
        help="Number of seeds per scenario (default: from config)."
    )
    ap.add_argument(
        "--pack", action="store_true", default=False,
        help="Run in pack (methodology) track instead of OOB."
    )
    ap.add_argument(
        "--mock", action="store_true", default=True,
        help="Run in mock mode (offline, no provider keys needed). DEFAULT: True."
    )
    ap.add_argument(
        "--no-mock", dest="mock", action="store_false",
        help="Disable mock mode for a real run (requires trained model + API keys)."
    )
    ap.add_argument(
        "--dry-run", action="store_true", default=False,
        help="Print the command that would be run without executing it."
    )
    a = ap.parse_args()

    config = load_config()
    eval_cfg = config.get("eval", {})
    seeds = a.seeds if a.seeds is not None else eval_cfg.get("default_seeds", 3)

    if not a.mock and a.ft_model == "kimi-k3-ft":
        print(
            "WARNING: Running without --mock requires a trained model checkpoint.\n"
            "Training is COMPUTE-GATED (Tinker-blocked) and OUT OF SCOPE for this scaffold.\n"
            "Set --ft-model to your actual trained checkpoint id.",
            file=sys.stderr
        )

    # Resolve baseline
    oob_baseline = a.oob_baseline
    if oob_baseline is None:
        oob_baseline = eval_cfg.get("oob_baseline_sqs")

    # Get scenario IDs from the dataset
    try:
        scenario_ids = get_scenario_ids(config)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    cmd = build_rollout_command(
        scenarios=scenario_ids,
        seller_spec=a.ft_model,
        seeds=seeds,
        pack=a.pack,
        mock=a.mock,
    )

    print("=" * 60)
    print("VEB FT Eval Driver — kimi-k3 one-arm scaffold")
    print("=" * 60)
    print(f"Model:       {a.ft_model}")
    print(f"Scenarios:   {len(scenario_ids)} ({', '.join(scenario_ids[:3])}{'...' if len(scenario_ids) > 3 else ''})")
    print(f"Seeds:       {seeds}")
    print(f"Track:       {'pack' if a.pack else 'oob'}")
    print(f"Mock mode:   {a.mock}")
    print(f"OOB baseline:{f' {oob_baseline:.2f}' if oob_baseline is not None else ' (not set — provide --oob-baseline)'}")
    print()
    print("Command:")
    print("  " + " ".join(cmd))
    print()

    if a.dry_run:
        print("DRY RUN: not executing. Remove --dry-run to run.")
        return

    print("Running rollout (this may take a while)...")
    result = subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True
    )

    if result.returncode != 0:
        print(f"ERROR: rollout exited with code {result.returncode}", file=sys.stderr)
        print("STDERR:", result.stderr[:2000], file=sys.stderr)
        sys.exit(result.returncode)

    # Parse SQS from output
    scores = parse_sqs_from_output(result.stdout)

    print(f"Parsed {len(scores)} SQS scores from rollout output.")

    if not scores:
        print(
            "WARNING: No SQS scores found in rollout output.\n"
            "Ensure the CLI outputs JSON with saleQualityScore fields.\n"
            "Raw stdout (first 2000 chars):\n" + result.stdout[:2000]
        )
        return

    ft_mean = sum(scores) / len(scores)
    print(f"FT mean SQS:    {ft_mean:.2f}")

    if oob_baseline is not None:
        lift = ft_mean - oob_baseline
        print(f"OOB baseline:   {oob_baseline:.2f}")
        print(f"OOB->FT lift:   {lift:+.2f} SQS points")
    else:
        print(
            "OOB->FT lift:   N/A (provide --oob-baseline <sqs> to compute delta)"
        )

    print()
    print("NOTE: This computes the real lift from environment rollouts.")
    print("The base-arm locked baseline (base-on-pack lift ≈ 0) is documented in")
    print("finetune/config.kimi-k3.json under eval.oob_baseline_sqs.")


if __name__ == "__main__":
    main()
