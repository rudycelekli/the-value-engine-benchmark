# VEB Canonical-135 — Sales-Negotiation Trajectory Dataset

Multi-turn LLM **sales-negotiation** rollouts from **The Value Engine Benchmark (VEB)**.
Every datapoint is a complete negotiation episode between an LLM **seller** and a
stochastic LLM **buyer**, paired with a detailed **judge grade** and a scalar
**reward**. Designed for RLHF / RLVR, reward-model training, offline RL, and
methodology research.

- **2,970 datapoints** — one self-contained JSON object per line (JSONL)
- **Grid:** 11 models × 9 scenarios × 15 seeds × 2 tracks (`oob`, `pack`) = **135 rollouts / model / track**
- **Fidelity:** full trajectory (`episode`) + full rubric (`grade`) + `reward` embedded in every row
- **Integrity:** 0 missing episode, 0 missing grade, 0 zero-turn rollouts (verified)

## Files

| File | Purpose |
|------|---------|
| `veb-canonical-135-preview.jsonl` | **Free evaluation sample** (66 lines, ~10M) — same schema, full fidelity, CC BY-NC 4.0 |
| `veb-canonical-135.jsonl` | The full dataset (470M, 2,970 lines) — distributed out-of-band |
| `veb-canonical-135.jsonl.gz` | Compressed copy for transfer (121M) |
| `*.sha256` | SHA-256 checksums for integrity verification |
| `manifest.json` | Machine-readable provenance, schema, per-model/track counts |
| `DATASHEET.md` | *Datasheet for Datasets* — motivation, composition, uses, limitations |
| `README.md` | This file |

### Free preview subset

`veb-canonical-135-preview.jsonl` is a **66-row stratified sample** you can open
and inspect without any purchase: every one of the 11 models, both tracks, all 9
scenarios, and a deliberate over-sampling of the rare high-signal outcomes
(won / lost / walked_away) so you can see the judge rubric actually
discriminating. Each preview row is a *verbatim, full-fidelity* datapoint
(episode + grade embedded) — not a reduced or redacted view. Released under
**CC BY-NC 4.0**; the full-dataset license is negotiated separately. See
`DATASHEET.md` for the complete provenance and fitness-for-use.

### Verify then unpack

```bash
shasum -a 256 -c veb-canonical-135.jsonl.gz.sha256   # expect: OK
gunzip -k veb-canonical-135.jsonl.gz
wc -l veb-canonical-135.jsonl                        # expect: 2970
```

## Row schema

Each line is one datapoint with these top-level keys:

| Key | Description |
|-----|-------------|
| `id` | Stable cell id — `scenario·model_spec[+pack]·s<seed>` |
| `env` | `{ scenario_id, task_checksum, seed }` |
| `model` | `{ spec, provider, model, pack }` — the seller under test |
| `buyer_sim` | Buyer configuration string (stochastic LLM buyer, seeded per rollout) |
| `seed` | Rollout seed (1–15) |
| `reward` | Scalar reward in [0,1] for RLVR / offline RL |
| `resolved` | Whether the deal reached a resolution |
| `cleared_bar` | Whether the rollout cleared the quality bar |
| `reward_breakdown` | Component decomposition of `reward` |
| `trajectory` | Compact turn/action summary |
| `format_retries` | Count of format-corrective retries during the episode |
| `cost` | `{ usd, tokens... }` — API cost of the rollout |
| `transcript_ref` | Pointer to the human-readable transcript view |
| `provenance` | Run/source metadata |
| `generated_at` | ISO timestamp |
| `episode` | **Full trajectory** (see below) |
| `grade` | **Full judge rubric** (see below) |

### `episode` (the trajectory)

`scenarioId`, `sellerId`, `pack`, `mock`, `startedAt`, `finishedAt`,
`turns` (the full multi-turn message/action sequence — seller, buyer, and system),
`events`, `signals`, `internalChannel` (the seller's private reasoning channel),
`finalState`, `outcome`.

### `grade` (the judge rubric)

`scenarioId`, `sellerId`, `pack`, `gradedAt`, `judge`, `outcome`, `meddpicc`,
`threeWhys`, `ebEngagement`, `mapDatesConfirmedPct`, `champion`,
`conditionalCommitmentBeforeProof`, `priceIntegrity`, `dvi`, `saleQualityScore`,
`failureModes`, `scenarioMeta`, `walkAways`, `internalChannelReveal`, `notes`.

## Design

- **Tracks:** `oob` = out-of-the-box seller prompt; `pack` = seller augmented with a
  structured sales-methodology pack. The paired design supports within-pair lift estimates.
- **Stochastic buyer:** each rollout faces a fresh, seeded stochastic LLM buyer
  (not frozen replay), averaged over 15 seeds per scenario for realism.
- **Dedup rule:** rows are deduplicated by `(scenario_id, model, pack, seed)`,
  keeping the latest `generated_at`. See `manifest.json` for the full roster and counts.
- **Roster:** `gpt-5.5-pro` is intentionally excluded (off-roster, reasoning-only
  exploratory arm). The 11 graded models are listed in `manifest.json`.

## Quick start

```python
import json

with open("veb-canonical-135.jsonl") as f:
    for line in f:
        r = json.loads(line)
        turns  = r["episode"]["turns"]      # full negotiation trajectory
        reward = r["reward"]                # RLVR signal
        sqs    = r["grade"]["saleQualityScore"]
        # ... build preference pairs, reward-model targets, or SFT data
```

## Provenance

- **Benchmark:** The Value Engine Benchmark (VEB)
- **Grid frozen:** 2026-07-13, canonical-135, 2,970/2,970 (100%)
- **Integrity:** all checksums in `*.sha256`; row-level integrity verified (0 missing episode/grade, 0 zero-turn)

## License / usage

**CC BY-NC 4.0.** The free evaluation sample (`veb-canonical-135-preview.jsonl`,
66 rows) is released under [CC BY-NC 4.0](../../LICENSE-DATA). The code that
generates and grades these rows is separately licensed Apache-2.0
([LICENSE-CODE](../../LICENSE-CODE)). The full dataset
(`veb-canonical-135.jsonl`, 2,970 rows) is distributed out-of-band and its
license is negotiated separately with the dataset owner. Contact the owner
before redistribution.
