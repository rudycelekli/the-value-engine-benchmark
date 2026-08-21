# Getting the full data

This repository ships the **datasheet, manifest, statistics, a full-fidelity
preview, and SHA-256 checksums** for the VEB canonical-135 dataset. The complete
trajectory files are too large for a Git repository and are distributed
separately.

## Files in the full release

| File | Size | SHA-256 (committed in this repo) |
|------|------|----------------------------------|
| `veb-canonical-135.jsonl` | ~557 MB | see `datasets/veb-canonical-135/veb-canonical-135.jsonl.sha256` |
| `veb-canonical-135.jsonl.gz` | ~144 MB | see `datasets/veb-canonical-135/veb-canonical-135.jsonl.gz.sha256` |
| `veb-canonical-135-preview.jsonl` | ~11 MB | **included in this repo** |

The canonical full-file digest
(`13a9e6e5ac7a638207423393d24153ac31b9d3b92fdb09a77783c83b2af98f05`) is recorded
in three places — the `.sha256` sidecar, `manifest.json`, and
`paper-stats.json`'s `lineage.source_sha256` — and `make verify` fails if any of
them disagree. That last one is what ties the published statistics to these exact
bytes: the committed numbers were computed from this file, not from some other
copy of it.

## Verifying a download

```bash
# from inside datasets/veb-canonical-135/
shasum -a 256 -c veb-canonical-135.jsonl.sha256
shasum -a 256 -c veb-canonical-135.jsonl.gz.sha256
```

A matching digest guarantees the file is byte-identical to the frozen
canonical-135 release described in the paper and datasheet.

## Licensing

The 78-row preview is released as a **free evaluation sample under CC BY-NC 4.0**
(see `manifest.json` and `LICENSE-DATA`). The full dataset license is negotiated
separately. The environment code that produces and grades these rows is licensed
**Apache-2.0** (`LICENSE-CODE`) — you may run, modify, and build on the harness
commercially; the graded rollout corpus is what stays noncommercial.

## Access

To request the full dataset, contact **The Value Engine / Gradia**:
[thevalueengine.ai](https://thevalueengine.ai) · [gradiahq.com](https://gradiahq.com).
