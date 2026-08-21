# The Value Engine Benchmark (VEB)

[![ci](https://github.com/rudycelekli/the-value-engine-benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/rudycelekli/the-value-engine-benchmark/actions/workflows/ci.yml)
[![code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE-CODE)
[![data: CC BY-NC 4.0](https://img.shields.io/badge/data-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE-DATA)

**An evidence-graded, methodology-controlled environment for evaluating — and training — LLM agents on multi-touch enterprise-sales negotiation.**

By [The Value Engine](https://thevalueengine.ai) · [Gradia](https://gradiahq.com)

VEB puts a language model in the seat of a B2B seller across a multi-turn
negotiation against a stochastic LLM buyer, then grades every episode with an
explicit sales-methodology rubric. It produces both a **scalar reward**
(for RLVR / offline RL) and a **structured diagnostic grade** (for reward-model
training and error analysis). Single-turn benchmarks do not stress long-horizon
planning, value framing, price discipline, and honesty-under-pressure the way a
real sales cycle does — VEB is built to.

---

## What's in this repo

The environment is the headline: `src/` is a runnable RL environment, not a
static leaderboard dump.

| Path | Contents |
|------|----------|
| [`src/`](src/) | The environment itself — episode runner, stochastic LLM buyer sim, seller adapters, rubric judge, and [`src/env/`](src/env/): scalar reward, CTRF milestone report, verifier artifacts, and a [Harbor / Terminal-Bench-2 task-package emitter](src/env/harbor.ts) that exports any scenario as a self-contained, resettable task dir with an oracle solution. |
| [`scenarios/`](scenarios/) | The 9 negotiation scenarios — buyer personas, deal economics, hidden constraints, and the milestone/veto rules the reward is computed from. |
| [`analysis/`](analysis/) | Stats recomputation ([`verify_stats.py`](analysis/verify_stats.py)), paper-macro generation from `paper-stats.json`, and their tests. Run in CI, so a headline number cannot drift from the data. |
| [`validation/`](validation/) | Judge-vs-human agreement protocol: blind grading sheet, rater qualification, and Cohen's κ / Krippendorff's α computation. |
| [`finetune/`](finetune/) | SFT/RLVR export — turns graded rollouts into `prompt` / `completion` / `reward` training rows. |
| [`paper/`](paper/) | Full research paper — LaTeX source + compiled [`main.pdf`](paper/main.pdf). Target venue: NeurIPS Datasets & Benchmarks. |
| [`datasets/veb-canonical-135/`](datasets/veb-canonical-135/) | Canonical dataset artifacts: a Gebru-style [`DATASHEET.md`](datasets/veb-canonical-135/DATASHEET.md), `manifest.json`, `paper-stats.json`, a **78-row full-fidelity preview** (`*-preview.jsonl`), and SHA-256 checksums for the full release. |
| [`datasets/veb-base-540/`](datasets/veb-base-540/) | Base-model leaderboard (540-cell base grid). |
| [`results/`](results/) | Findings reports (HTML), the harness leaderboard, and the fine-tuning lift report. |
| [`DATA.md`](DATA.md) | How to obtain and verify the full dataset. |

The full trajectory JSONL (557 MB uncompressed, 144 MB gzipped) exceeds GitHub's file limits and is
distributed separately — see [`DATA.md`](DATA.md). Its SHA-256 checksums are
committed here so any download can be verified byte-for-byte.

**Licensing is split:** code is Apache-2.0 ([`LICENSE-CODE`](LICENSE-CODE)) so you
can run, fork, and build on the environment commercially; the graded rollout
corpus, results, and paper are CC BY-NC 4.0 ([`LICENSE-DATA`](LICENSE-DATA)).

---

## The evaluation grid

- **13 models** (11 closed-weight + 2 open-weight), out-of-the-box (`oob`) vs. methodology-pack (`pack`) tracks
- **9 scenarios × 15 seeds** per model per track → **135 cells/model/track**, **270/model**
- **3,510 graded episodes** in the canonical-135 freeze (2026-08-20)

Roster: `claude-opus-4-8`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-fable-5`,
`gpt-5.6-sol`, `gpt-5.5`, `gemini-3.1-pro-preview`, `gemini-3.5-flash`,
`grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`, `moonshotai/kimi-k3`,
`thinkingmachines/inkling`. The two open-weight endpoints are full members of the
canonical grid — graded on every cell, on the leaderboard, not a side experiment.

Every datapoint is one self-contained JSONL line with the full `episode`
(turns, events, internal-channel thoughts, final state, outcome) and the full
`grade` (MEDDPICC, three-whys, EB engagement, MAP dates, champion, price
integrity, DVI, **Sale Quality Score**, failure modes) embedded.

---

## Verify it yourself

Be clear about what a clone of this repo does and does not let you check.

**What you can verify here, offline, with no API key:**

```bash
make demo        # produce a fresh graded episode end-to-end
make calibrate   # environment-validity gate: naive must NOT win, disciplined must clear
make test        # TypeScript suite
make pytest      # Python suite (macros, released-row schema, stats verifier, export, κ/α)
make verify      # provenance/roster/checksum invariants over the released preview
```

`make verify` runs [`analysis/verify_stats.py`](analysis/verify_stats.py) in one
of two modes. With only the preview present it runs **PREVIEW MODE** — ten
invariants over the released artifacts:

- the roster and grid width match the rows themselves;
- the preview digest agrees with *every* place that records it (the `.sha256`
  sidecar **and** `manifest.json`) — that cross-check exists because a stale
  manifest digest once slipped past a sidecar-only check;
- `paper-stats.json` carries a complete `lineage` block — which file each number
  was computed from, its sha256 and byte count, the generator and its digest,
  the generation timestamp, and the git sha/dirty state of the tree it ran in;
- the **full-dataset** digest likewise agrees across all three places that
  record it (sidecar, `manifest.json`, `paper-stats.lineage`), so the committed
  statistics provably describe the same bytes you download;
- `paper/result-macros.tex` cites the digest of the `paper-stats.json` it was
  generated from, so a macro that outlived its source fails the gate instead of
  reaching the paper.

Drop the full `veb-canonical-135.jsonl` into `datasets/veb-canonical-135/` and
the same command runs **FULL MODE**: it first confirms the file on disk is the
one the lineage names, then recomputes every headline number from the rows and
diffs against the committed `paper-stats.json`. The committed statistics in this
release were produced that way — reproduced key-for-key from the 3,510-row file
at `13a9e6e5…`, on a clean tree, with the lineage block recording it.

One honest exception, recorded in the lineage rather than glossed: the three
latency/reliability numbers derive from a provider telemetry export that is
operational data and is **not** distributed. Those three are not reproducible
from the released dataset; every other number is.

Checksums for both files are committed:

```bash
cd datasets/veb-canonical-135
shasum -a 256 -c veb-canonical-135-preview.jsonl.sha256
# and for the full release once downloaded (see DATA.md):
shasum -a 256 -c veb-canonical-135.jsonl.sha256
```

**What you cannot verify from this repo alone:** the 3,510-row source needed for
FULL MODE is distributed out-of-band (see [`DATA.md`](DATA.md)), so the headline
statistics are recomputable *by anyone who requests the dataset*, not by a
drive-by cloner. The preview is a stratified, full-fidelity sample — 6 rows per
model across both tracks and 8 of the 9 scenarios, balanced across the decisive
outcomes so the judge rubric is visibly discriminating — but 78 rows are an
integrity and schema check, not a statistical one.

**Provenance caveat, stated plainly:** every released row carries
`provenance.git.dirty = true`. These rollouts were generated inside the private
development repo while that tree had uncommitted changes, so the recorded
`git.sha` identifies the checkout the run *started from*, not the exact bytes of
code that produced the row. What is pinned is the scenario world
(`provenance.taskChecksum`, an sha256 of the canonical scenario JSON), the frozen
buyer-sim version, the seed, and the released rows themselves.

That rule is now enforced rather than promised. The three commands that emit
released artifacts — `env rollout`, `env dataset`, `env evidence` — refuse to
run and exit non-zero unless the git state actually proves which code produced
the rows (`src/env/provenance.ts`, `assertCleanTreeForRelease`). Two states fail
that test:

- a **dirty tree**, where `git.sha` names the checkout the run started from
  rather than the code that produced the row;
- an **indeterminate** state — run outside a repository, without a git binary,
  or before the first commit — where the row would record `sha: "unknown"` and
  name no code at all.

The second case is a gate the first version of this code got wrong: `gitState()`
failed open to `{sha: "unknown", dirty: false}`, which reads as clean, so an
`env rollout` outside a repository emitted a release row anyway. Absence of
evidence was being recorded as evidence of cleanliness. Both states are now
refused by default, and each has a unit test plus an end-to-end CLI test that
builds the failing condition (a throwaway dirty repo; a bare non-repo directory)
so the gate is proven to fire regardless of the tree the suite runs in.

The override is `--allow-dirty`, which prints a warning naming the rows as
unreleasable. In both cases the row keeps the very field that makes it
ineligible — `dirty: true` or `sha: "unknown"` — so using the override leaves
the same trace in the data that it does on the console. The canonical-135 freeze
predates the gate and is not retroactively fixable, so it is disclosed instead
of papered over.

---

## Run it

Everything here is offline and needs no API key — the mock buyer + heuristic
judge produce a full graded episode:

```bash
make build       # npm ci && npm run build
make demo        # offline graded episode (mock buyer, scripted-disciplined seller)
make calibrate   # environment-validity gate: naive must NOT win, disciplined must clear
make verify      # recompute paper-stats from released rows, diff vs committed
make test        # run the test suite
```

For a live rollout against a real model (needs a key in `.env`):

```bash
make live SELLER=anthropic:claude-opus-4-8 SCENARIO=logistics-saas
```

---

## Build the paper

```bash
cd paper
tectonic main.tex   # or: latexmk -pdf main.tex
```

---

## Contact

Rudy M. Celekli · The Value Engine ([thevalueengine.ai](https://thevalueengine.ai)) · Gradia ([gradiahq.com](https://gradiahq.com))
