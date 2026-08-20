# kimi-k3 Fine-Tuning Scaffold

This directory contains the runnable scaffold for the held-out open-weight
fine-tuning arm (kimi-k3 / Inkling) described as future work in the VEB paper.
The pipeline is real and inspectable. Only the GPU training step is pending
(compute-gated / Tinker-blocked) and is explicitly OUT OF SCOPE for this scaffold.

---

## What ships now

| File | Purpose |
|------|---------|
| `export_sft.py` | Exports `(prompt, completion, reward)` JSONL from canonical episodes |
| `config.kimi-k3.json` | Base model id, LoRA/SFT hyperparams, dataset + output paths (documented defaults; nothing is trained) |
| `eval.py` | Runs an FT seller back through the real VEB env CLI; computes OOB→FT SQS lift from actual rollout output |
| `test_export.py` | Pytest verifying the exporter produces well-formed rows |

---

## Unblock sequence

### 1. Export SFT training rows

```bash
python3 finetune/export_sft.py --out finetune/sft-kimi-k3.jsonl
```

This reads `datasets/veb-canonical-135/veb-canonical-135-preview.jsonl`,
filters to `training_ready == True` rows (44 of 66 in the preview), and
writes `(prompt, completion, reward)` JSONL.

- `prompt` — scenario id, industry, difficulty, track, and the verbatim
  system-actor turn contents (the task framing the seller saw).
- `completion` — verbatim seller-actor turn contents joined in turn order.
- `reward` — `saleQualityScore / 100` (the paper's `[0, 1]` SQS convention).

### 2. Train on Tinker/compute — COMPUTE-GATED, OUT OF SCOPE

```bash
# NOT RUN HERE. Requires GPU cluster access (Tinker-blocked).
# Hyperparameters documented in finetune/config.kimi-k3.json.
```

Train a LoRA adapter on `finetune/sft-kimi-k3.jsonl` using the settings in
`config.kimi-k3.json` (rank 16, alpha 32, lr 2e-4, 3 epochs, batch 4 + grad
accum 4, cosine schedule).

### 3. Measure OOB→FT SQS lift

```bash
# Dry-run (prints command, does not execute):
python3 finetune/eval.py --dry-run

# Mock/offline run (no keys required, verifies driver logic):
python3 finetune/eval.py --mock

# Real run (after training is complete, requires trained model + provider keys):
python3 finetune/eval.py --ft-model <trained-checkpoint-id> --no-mock --oob-baseline <locked-base-sqs>
```

`eval.py` constructs and runs:

```
node dist/cli.js env rollout --scenarios <ids> --sellers <spec> --seeds <n> [--pack] [--mock]
```

It parses `saleQualityScore` from the rollout output and computes the
OOB→FT delta. No SQS values are fabricated — the lift is computed at run time
from real environment rollouts.

---

## Out-of-scope statement

**The following are explicitly OUT OF SCOPE for this scaffold:**

- Executing model training (GPU/compute-gated, Tinker-blocked)
- Inventing or fabricating SQS scores or lift numbers
- Evaluating the FT model against live providers without a trained checkpoint

**What is in scope (ships now):**

- The exporter (`export_sft.py`) — produces real, reproducible SFT rows
- The config (`config.kimi-k3.json`) — documents training hyperparameters
- The eval driver (`eval.py`) — constructs and runs the real env CLI, parses
  real SQS output, computes the real delta

---

## Context

The base arm is already locked: **base-on-pack lift ≈ 0** (95% CI covers zero,
per `docs/VEB-FT-LIFT-REPORT.md`). This scaffold sets up the FT arm to measure
whether LoRA fine-tuning on VEB episodes produces a genuine SQS lift beyond the
base. The 2×2 design (base/FT × oob/pack) described in the paper is the intended
evaluation structure; this scaffold provides the FT-arm pipeline.

---

## Running the test

```bash
python3 -m pytest finetune/test_export.py -q
```

Expected output: `1 passed`.
