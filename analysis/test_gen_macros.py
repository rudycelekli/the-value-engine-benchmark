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
    # resCellsComplete must be 2970, NOT 3510. Checked over macro lines only:
    # the comment header carries sha256 digests, whose hex could coincidentally
    # contain "3510" and make this assertion content-flaky.
    assert "\\newcommand{\\resCellsComplete}{2970}" in tex
    macro_lines = [l for l in tex.splitlines() if not l.startswith("%")]
    assert "3510" not in "\n".join(macro_lines)


def test_macros_carry_source_lineage():
    """A macro without lineage is an unsourced number in the paper."""
    tex = (ROOT / "paper/result-macros.tex").read_text()
    header = [l for l in tex.splitlines() if l.startswith("%")]
    assert any("paper-stats.json" in l and "sha256" in l for l in header)
    assert any("veb-canonical-135.jsonl" in l for l in header)


def test_provenance_lists_every_macro():
    prov = (ROOT / "paper/macros-provenance.md").read_text()
    for m in ("resBestModel", "resBestModelSQS"):
        assert m in prov
