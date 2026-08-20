import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
PREVIEW = ROOT / "datasets/veb-canonical-135/veb-canonical-135-preview.jsonl"

def test_every_row_has_status_fields():
    for line in PREVIEW.open():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        for f in ("judge_type", "format_retries", "flags", "training_ready"):
            assert f in row, f"missing {f}"
        assert row["judge_type"] in ("llm", "heuristic")
        assert isinstance(row["format_retries"], int)
        assert isinstance(row["flags"], list)
        assert isinstance(row["training_ready"], bool)

def test_training_ready_excludes_heuristic_and_flagged():
    for line in PREVIEW.open():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row["judge_type"] == "heuristic" or row["flags"]:
            assert row["training_ready"] is False
