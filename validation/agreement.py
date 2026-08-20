#!/usr/bin/env python3
"""Cohen's kappa (judge vs each expert) + Krippendorff's alpha (all raters).
Input: a completed grading sheet CSV with columns episode_id, judge, expert1[, expert2...]."""
import sys, csv, itertools, collections

def cohens_kappa(a, b):
    n = len(a); cats = sorted(set(a) | set(b))
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = collections.Counter(a), collections.Counter(b)
    pe = sum((ca[c]/n) * (cb[c]/n) for c in cats)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)

def krippendorff_alpha(cols):
    items = list(zip(*cols))
    pairs = []
    for item in items:
        vals = [v for v in item if v is not None]
        for x, y in itertools.permutations(vals, 2):
            pairs.append((x, y))
    if not pairs: return float("nan")
    Do = sum(x != y for x, y in pairs) / len(pairs)
    allvals = [v for item in items for v in item if v is not None]
    N = len(allvals); cnt = collections.Counter(allvals)
    De = 1 - sum((c/N)**2 for c in cnt.values())
    return 1 - Do/De if De else float("nan")

def main(path):
    with open(path) as f:
        rows = list(csv.DictReader(f))
    cols = [c for c in rows[0].keys() if c != "episode_id"]
    data = {c: [int(r[c]) for r in rows] for c in cols}
    judge = data["judge"]
    experts = [c for c in cols if c != "judge"]
    for expert in experts:
        k = cohens_kappa(judge, data[expert])
        print(f"kappa(judge,{expert})={k}")
    # summary line for the primary (first) expert — literal `kappa=<v>`
    if experts:
        print(f"kappa={cohens_kappa(judge, data[experts[0]])}")
    alpha = krippendorff_alpha([data[c] for c in cols])
    print(f"alpha(all)={alpha}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
