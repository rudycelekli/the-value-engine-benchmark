"""Tests for gen-macros.py output correctness and provenance completeness."""
import subprocess, sys, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_emits_result_macros_from_stats():
    r = subprocess.run([sys.executable, "analysis/gen-macros.py"], cwd=ROOT)
    assert r.returncode == 0
    tex = (ROOT / "paper/result-macros.tex").read_text()
    assert "\\newcommand{\\resBestModel}" in tex
    assert "\\newcommand{\\resBestModelSQS}" in tex
    # No unresolved placeholders.
    assert "0.XX" not in tex and "\\NUM{" not in tex
    # resCellsComplete must be 2970, NOT 3510.
    assert "\\newcommand{\\resCellsComplete}{2970}" in tex
    assert "3510" not in tex


def test_provenance_lists_every_macro():
    prov = (ROOT / "paper/macros-provenance.md").read_text()
    for m in ("resBestModel", "resBestModelSQS"):
        assert m in prov
