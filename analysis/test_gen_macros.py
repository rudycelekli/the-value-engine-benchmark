"""Tests for gen-macros.py output correctness and provenance completeness."""
import json, subprocess, sys, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
STATS = ROOT / "datasets/veb-canonical-135/paper-stats.json"


def test_emits_result_macros_from_stats():
    r = subprocess.run([sys.executable, "analysis/gen-macros.py"], cwd=ROOT)
    assert r.returncode == 0
    tex = (ROOT / "paper/result-macros.tex").read_text()
    assert "\\newcommand{\\resBestModel}" in tex
    assert "\\newcommand{\\resBestModelSQS}" in tex
    # No unresolved placeholders.
    assert "0.XX" not in tex and "\\NUM{" not in tex
    # resCellsComplete must equal the grid the stats were actually computed
    # over. An earlier version of this test hardcoded the literal 2970 and
    # forbade 3510 -- so when the grid grew to 13 models the test kept passing
    # while pinning the paper to a roster that no longer existed. Assert
    # agreement with paper-stats.json instead: the invariant is "macros do not
    # drift from the stats", and no literal row count belongs in a test.
    stats = json.loads(STATS.read_text())
    assert f"\\newcommand{{\\resCellsComplete}}{{{stats['cells_graded']}}}" in tex

    # And the grid the macro asserts must actually multiply out. Checked over
    # macro lines only: the comment header carries sha256 digests whose hex
    # could coincidentally contain a row count and make this content-flaky.
    g = stats["grid"]
    assert g["models"] * g["scenarios"] * g["seeds"] * g["tracks"] == stats["rows"]
    macro_lines = "\n".join(l for l in tex.splitlines() if not l.startswith("%"))
    assert str(stats["rows"]) in macro_lines


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
