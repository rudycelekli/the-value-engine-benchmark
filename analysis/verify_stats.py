#!/usr/bin/env python3
"""Offline number-reproducer for veb-canonical-135 paper stats.

Two modes:
  PREVIEW MODE  — preview JSONL is present but full dataset is not.
                  Checks provenance / roster / checksum invariants only.
  FULL MODE     — full veb-canonical-135.jsonl is present.
                  Runs analyze-canonical-135.py into a temp file, then diffs
                  every JSONL-derivable headline number against the committed
                  paper-stats.json.  Does NOT touch the committed file.

Exit 0 iff all checks pass, nonzero on any mismatch.
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "datasets" / "veb-canonical-135"
COMMITTED   = DATASET_DIR / "paper-stats.json"
MANIFEST    = DATASET_DIR / "manifest.json"
PREVIEW     = DATASET_DIR / "veb-canonical-135-preview.jsonl"
PREVIEW_SHA = DATASET_DIR / "veb-canonical-135-preview.jsonl.sha256"
FULL        = DATASET_DIR / "veb-canonical-135.jsonl"
ANALYZE     = Path(__file__).parent / "analyze-canonical-135.py"

# Headline paths diffed in FULL mode (all derivable from JSONL only).
# Each entry is a tuple of keys to walk into the JSON dict.
HEADLINE_PATHS = [
    ("rows",),
    ("cells_graded",),
    ("best_model", "model"),
    ("best_model", "mean_sqs"),
    ("pack_lift", "sqs_points"),
    ("tracks", "oob", "mean_sqs"),
    ("tracks", "pack", "mean_sqs"),
]


def _get(d, *keys):
    for k in keys:
        d = d[k]
    return d


def _close(a, b):
    if isinstance(a, float) or isinstance(b, float):
        return math.isclose(float(a), float(b), rel_tol=1e-6)
    return a == b


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check(label: str, ok: bool, detail: str = "") -> bool:
    status = "OK  " if ok else "DIFF"
    msg = f"  [{status}] {label}"
    if detail:
        msg += f"  ({detail})"
    print(msg)
    return ok


def main() -> int:
    all_ok = True

    # ------------------------------------------------------------------ #
    # Sanity: committed file must exist                                   #
    # ------------------------------------------------------------------ #
    if not COMMITTED.exists():
        print(f"ERROR: committed file not found: {COMMITTED}", file=sys.stderr)
        return 1
    if not PREVIEW.exists():
        print(f"ERROR: preview JSONL not found: {PREVIEW}", file=sys.stderr)
        return 1
    if not PREVIEW_SHA.exists():
        print(f"ERROR: preview sha256 file not found: {PREVIEW_SHA}", file=sys.stderr)
        return 1

    committed = json.loads(COMMITTED.read_text())

    # ------------------------------------------------------------------ #
    # PREVIEW-DERIVABLE INVARIANTS (always checked)                       #
    # ------------------------------------------------------------------ #
    print("\n=== Preview-derivable invariants ===")

    # 1. source field
    ok = check(
        "committed[source] == 'veb-canonical-135.jsonl'",
        committed.get("source") == "veb-canonical-135.jsonl",
        f"got {committed.get('source')!r}",
    )
    all_ok = all_ok and ok

    # 2. roster matches distinct model.model values in preview
    preview_lines = [json.loads(l) for l in PREVIEW.read_text().splitlines() if l.strip()]
    preview_models = sorted({r["model"]["model"] for r in preview_lines})
    committed_roster = committed.get("roster", [])
    ok = check(
        "committed[roster] == sorted(distinct models in preview)",
        committed_roster == preview_models,
        f"committed={committed_roster} preview={preview_models}" if committed_roster != preview_models else "",
    )
    all_ok = all_ok and ok

    # 3. grid.models == len(distinct set)
    committed_grid_models = (committed.get("grid") or {}).get("models")
    ok = check(
        f"committed[grid][models] == {len(preview_models)}",
        committed_grid_models == len(preview_models),
        f"got {committed_grid_models}",
    )
    all_ok = all_ok and ok

    # 4. sha256 of preview matches the committed .sha256 file
    actual_sha = sha256_file(PREVIEW)
    committed_sha_token = PREVIEW_SHA.read_text().split()[0]
    ok = check(
        "sha256(preview JSONL) matches .sha256 file",
        actual_sha == committed_sha_token,
        f"file={committed_sha_token[:16]}… actual={actual_sha[:16]}…"
        if actual_sha != committed_sha_token else "",
    )
    all_ok = all_ok and ok

    # 5. ONE DIGEST EVERYWHERE: every place that records the preview digest must
    #    agree with the bytes on disk. The .sha256 sidecar alone is not enough --
    #    manifest.json embeds its own copy, and a regeneration that updated the
    #    sidecar but not the manifest is exactly the drift this catches.
    if not MANIFEST.exists():
        ok = check("manifest.json present", False, f"missing: {MANIFEST}")
        all_ok = False
        manifest = {}
    else:
        manifest = json.loads(MANIFEST.read_text())

    recorded = {".sha256 sidecar": committed_sha_token}
    manifest_preview = (manifest.get("preview") or {})
    if "sha256" in manifest_preview:
        recorded["manifest[preview][sha256]"] = manifest_preview["sha256"]

    disagreeing = {k: v for k, v in recorded.items() if v != actual_sha}
    ok = check(
        f"preview digest agrees across all {len(recorded)} recorded location(s)",
        not disagreeing,
        "; ".join(f"{k}={v[:16]}… != actual={actual_sha[:16]}…"
                  for k, v in disagreeing.items()) if disagreeing else "",
    )
    all_ok = all_ok and ok

    # 6. manifest preview row count matches the preview file
    if "rows" in manifest_preview:
        ok = check(
            "manifest[preview][rows] == rows in preview JSONL",
            manifest_preview["rows"] == len(preview_lines),
            f"manifest={manifest_preview['rows']} actual={len(preview_lines)}"
            if manifest_preview["rows"] != len(preview_lines) else "",
        )
        all_ok = all_ok and ok

    # 7. manifest and paper-stats must describe the same grid size
    if "rows" in manifest and "rows" in committed:
        ok = check(
            "manifest[rows] == paper-stats[rows]",
            manifest["rows"] == committed["rows"],
            f"manifest={manifest['rows']} paper-stats={committed['rows']}"
            if manifest["rows"] != committed["rows"] else "",
        )
        all_ok = all_ok and ok

    # ------------------------------------------------------------------ #
    # FULL MODE: recompute from veb-canonical-135.jsonl                  #
    # ------------------------------------------------------------------ #
    full_mode = FULL.exists()
    tmpfile = None
    if full_mode:
        print("\n=== Full-mode numeric recompute ===")
        try:
            fd, tmppath = tempfile.mkstemp(suffix=".json", prefix="veb-verify-")
            os.close(fd)
            tmpfile = Path(tmppath)

            env = {**os.environ, "VEB_ROWS": str(FULL), "VEB_STATS_OUT": str(tmpfile)}
            result = subprocess.run(
                [sys.executable, str(ANALYZE)],
                env=env,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"  [DIFF] analyze script failed (exit {result.returncode})")
                print(result.stderr, file=sys.stderr)
                all_ok = False
            else:
                recomputed = json.loads(tmpfile.read_text())
                for path in HEADLINE_PATHS:
                    try:
                        c_val = _get(committed, *path)
                        r_val = _get(recomputed, *path)
                        match = _close(c_val, r_val)
                        ok = check(
                            ".".join(str(k) for k in path),
                            match,
                            f"committed={c_val!r} recomputed={r_val!r}" if not match else "",
                        )
                        all_ok = all_ok and ok
                    except (KeyError, TypeError) as exc:
                        ok = check(".".join(str(k) for k in path), False, f"key error: {exc}")
                        all_ok = False
        finally:
            if tmpfile and tmpfile.exists():
                tmpfile.unlink()

    # ------------------------------------------------------------------ #
    # Safety assertion: committed file must be unmodified                 #
    # ------------------------------------------------------------------ #
    # (We never write to COMMITTED, but assert it defensively.)
    committed_now = json.loads(COMMITTED.read_text())
    if committed_now != committed:
        print("\n  [BUG] verify_stats.py modified the committed file — this is a bug!", file=sys.stderr)
        all_ok = False

    # ------------------------------------------------------------------ #
    # Final line                                                          #
    # ------------------------------------------------------------------ #
    print()
    if full_mode:
        print("FULL MODE — recomputed every headline number from veb-canonical-135.jsonl")
    else:
        print(
            "PREVIEW MODE — verified provenance/roster/checksum; "
            "full numeric recompute needs veb-canonical-135.jsonl (see DATA.md)"
        )

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
