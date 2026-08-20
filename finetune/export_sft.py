#!/usr/bin/env python3
"""Export SFT rows (prompt, completion, reward) from canonical episodes.
Only training_ready rows are used (Task 14 annotation). prompt/completion are a
transparent serialization of the episode's system-framing and seller output;
reward is the paper's SQS/100 convention."""
import json, argparse, glob, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def rows():
    pattern = str(ROOT / "datasets/veb-canonical-135/veb-canonical-135*.jsonl")
    matches = sorted(glob.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No JSONL found matching: {pattern}")
    f = matches[0]
    for line in open(f):
        line = line.strip()
        if line:
            yield json.loads(line)


def to_sft(r):
    grade = r.get("grade", {})
    meta = grade.get("scenarioMeta", {})
    track = "pack" if r.get("model", {}).get("pack") else "oob"
    scenario = r.get("env", {}).get("scenario_id", "")
    turns = r.get("episode", {}).get("turns", [])
    system_turns = [t.get("content", "") for t in turns if t.get("actor") == "system"]
    seller_turns = [t.get("content", "") for t in turns if t.get("actor") == "seller"]
    prompt = (
        f"Scenario: {scenario}\n"
        f"Industry: {meta.get('industry', '')}\n"
        f"Difficulty: {meta.get('difficulty', '')}\n"
        f"Track: {track}\n\n"
        "Task framing:\n" + "\n\n".join(system_turns)
    )
    completion = "\n\n".join(seller_turns)
    reward = round(grade.get("saleQualityScore", 0.0) / 100.0, 4)
    return {"prompt": prompt, "completion": completion, "reward": reward}


def main():
    ap = argparse.ArgumentParser(
        description="Export SFT training rows from VEB canonical episodes."
    )
    ap.add_argument("--out", required=True, help="Output JSONL path.")
    ap.add_argument(
        "--limit", type=int, default=0,
        help="Max rows to export (0 = all training_ready rows)."
    )
    a = ap.parse_args()
    out = []
    for r in rows():
        if a.limit and len(out) >= a.limit:
            break
        if r.get("training_ready", False):
            out.append(to_sft(r))
    pathlib.Path(a.out).write_text("\n".join(json.dumps(x) for x in out) + "\n")
    print(f"wrote {len(out)} SFT rows -> {a.out}")


if __name__ == "__main__":
    main()
