"""Pytest suite for analysis/verify_stats.py.

Two cases:
  1. test_verify_passes_on_committed_stats — runs verify_stats.py against the
     committed paper-stats.json; asserts exit 0.
  2. test_verify_fails_on_tampered_stats  — backs up paper-stats.json, appends
     a fake model to committed[roster], writes it, asserts exit != 0, then
     restores the backup in a finally block.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFY = Path(__file__).parent / "verify_stats.py"
PAPER_STATS = ROOT / "datasets" / "veb-canonical-135" / "paper-stats.json"
MANIFEST = ROOT / "datasets" / "veb-canonical-135" / "manifest.json"


def test_verify_passes_on_committed_stats():
    result = subprocess.run(
        [sys.executable, str(VERIFY)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    assert result.returncode == 0, (
        f"verify_stats.py exited {result.returncode} but expected 0.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_verify_fails_on_tampered_stats():
    backup = PAPER_STATS.with_suffix(".json.bak")
    shutil.copy2(PAPER_STATS, backup)
    try:
        data = json.loads(PAPER_STATS.read_text())
        # Tamper: append a fake model to roster — this is checked in every mode.
        data["roster"] = data["roster"] + ["zzz-not-a-model"]
        PAPER_STATS.write_text(json.dumps(data, indent=2))

        result = subprocess.run(
            [sys.executable, str(VERIFY)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        assert result.returncode != 0, (
            f"verify_stats.py exited 0 on tampered stats but expected nonzero.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    finally:
        shutil.copy2(backup, PAPER_STATS)
        backup.unlink()


def test_verify_fails_on_stale_manifest_preview_sha():
    """A digest recorded in manifest.json must track the preview bytes.

    Regression guard: the .sha256 sidecar was once regenerated after the preview
    rows were re-annotated while manifest.json kept its old digest. The sidecar
    check passed, so nothing caught the drift. This asserts that a manifest
    digest disagreeing with the file on disk fails the run.
    """
    backup = MANIFEST.with_suffix(".json.bak")
    shutil.copy2(MANIFEST, backup)
    try:
        data = json.loads(MANIFEST.read_text())
        data["preview"]["sha256"] = "0" * 64
        MANIFEST.write_text(json.dumps(data, indent=2))

        result = subprocess.run(
            [sys.executable, str(VERIFY)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        assert result.returncode != 0, (
            "verify_stats.py exited 0 with a stale manifest preview digest.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    finally:
        shutil.copy2(backup, MANIFEST)
        backup.unlink()


def _verify_fails_with(mutate):
    """Apply `mutate` to paper-stats.json, assert verify fails, always restore."""
    backup = PAPER_STATS.with_suffix(".json.bak")
    shutil.copy2(PAPER_STATS, backup)
    try:
        data = json.loads(PAPER_STATS.read_text())
        mutate(data)
        PAPER_STATS.write_text(json.dumps(data, indent=2))
        result = subprocess.run(
            [sys.executable, str(VERIFY)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        assert result.returncode != 0, (
            f"verify_stats.py exited 0 on mutated lineage.\nstdout:\n{result.stdout}"
        )
    finally:
        shutil.copy2(backup, PAPER_STATS)
        backup.unlink()


def test_verify_fails_without_lineage():
    """Stats with no recorded source are unsourced numbers — reject them."""
    _verify_fails_with(lambda d: d.pop("lineage", None))


def test_verify_fails_on_lineage_source_digest_drift():
    """The stats' source digest must match the digest the release advertises.

    If they diverge, the headline numbers were computed from some file other
    than the one a reader downloads and checksums.
    """
    def mutate(d):
        d["lineage"]["source_sha256"] = "0" * 64
    _verify_fails_with(mutate)
