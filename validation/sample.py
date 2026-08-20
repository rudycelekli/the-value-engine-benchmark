#!/usr/bin/env python3
"""Pre-registered stratified sampler: up to 300 episodes balanced across
model/track/scenario/outcome, fixed seed, frozen ID list.
Only the preview ships publicly (66 rows); samples min(300, available)."""
import json, random, pathlib, collections, sys, glob
ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED = 20260820; N = 300

def load():
    files = sorted(glob.glob(str(ROOT/"datasets/veb-canonical-135/veb-canonical-135*.jsonl")))
    rows = []
    for f in files:
        for line in open(f):
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def stratum(r):
    m = r.get("model", {})
    return (m.get("model") or m.get("spec"),
            "pack" if m.get("pack") else "oob",
            r.get("env", {}).get("scenario_id"),
            r.get("grade", {}).get("outcome"))

def main():
    rows = load()
    if not rows:
        print("no rows found", file=sys.stderr); return 1
    rng = random.Random(SEED)
    by = collections.defaultdict(list)
    for r in rows: by[stratum(r)].append(r)
    strata = list(by); rng.shuffle(strata)
    picked, i, target = [], 0, min(N, len(rows))
    while len(picked) < target:
        s = strata[i % len(strata)]
        if by[s]: picked.append(by[s].pop())
        i += 1
        if all(not v for v in by.values()): break
    ids = [p.get("id") for p in picked]
    (ROOT/"validation/sampled-ids.json").write_text(json.dumps(ids, indent=2))
    print(f"sampled {len(ids)} episodes (seed={SEED}) across {len(by)} strata")
    return 0

if __name__ == "__main__":
    sys.exit(main())
