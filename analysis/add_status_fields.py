"""
Idempotent annotator: adds judge_type, format_retries, flags, training_ready
to every row of the veb-canonical-135 preview JSONL.

Safe to run multiple times (re-derives from real fields, never appends duplicates).
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PREVIEW = ROOT / "datasets/veb-canonical-135/veb-canonical-135-preview.jsonl"


def derive_status(row: dict) -> dict:
    judge_type = row["grade"]["judge"]              # verbatim real field
    format_retries = int(row["format_retries"])     # verbatim top-level real field

    flags = []
    if judge_type == "heuristic":
        flags.append("heuristic_fallback")
    if format_retries > 0:
        flags.append("format_retry")

    training_ready = (judge_type == "llm") and (len(flags) == 0)

    return {
        "judge_type": judge_type,
        "format_retries": format_retries,
        "flags": flags,
        "training_ready": training_ready,
    }


def main():
    # Check first row raw bytes to decide ensure_ascii setting
    with open(PREVIEW, "rb") as fh:
        first_bytes = fh.read(4096)
    has_non_ascii = any(b > 127 for b in first_bytes)
    ensure_ascii = not has_non_ascii

    rows = []
    with open(PREVIEW, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))

    annotated = []
    for row in rows:
        status = derive_status(row)
        # Overwrite (idempotent) rather than append
        row["judge_type"] = status["judge_type"]
        row["format_retries"] = status["format_retries"]
        row["flags"] = status["flags"]
        row["training_ready"] = status["training_ready"]
        annotated.append(row)

    with open(PREVIEW, "w", encoding="utf-8") as fh:
        for row in annotated:
            fh.write(json.dumps(row, ensure_ascii=ensure_ascii) + "\n")

    # Summary
    n_total = len(annotated)
    n_training_ready = sum(1 for r in annotated if r["training_ready"])
    n_flagged = sum(1 for r in annotated if r["flags"])
    n_heuristic = sum(1 for r in annotated if r["judge_type"] == "heuristic")
    n_format_retry = sum(1 for r in annotated if r["format_retries"] > 0)

    print(f"Annotated {n_total} rows.")
    print(f"  judge_type=heuristic : {n_heuristic}")
    print(f"  format_retries>0     : {n_format_retry}")
    print(f"  flagged (any flag)   : {n_flagged}")
    print(f"  training_ready=True  : {n_training_ready}")
    print(f"  training_ready=False : {n_total - n_training_ready}")


if __name__ == "__main__":
    main()
