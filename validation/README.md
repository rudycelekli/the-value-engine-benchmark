# Human-Validation Study Kit — Pre-Registration Protocol

## Purpose

This kit operationalises the forthcoming judge↔human agreement study referenced
in the VEB paper. It ships the runnable machinery — stratified sampler, κ/α
computer, and blind grading protocol — so the "forthcoming" claim is backed by
inspectable code. Actual human grading is **out of scope** for this kit.

---

## Hypothesis

VEB's automated LLM judge scores track qualified human-expert scores on an
evidence-cited basis. Specifically, we expect Cohen's κ (judge vs each expert)
≥ 0.70 and Krippendorff's α (all raters) ≥ 0.65 on the sampled episode set,
indicating substantial agreement between the automated judge and enterprise-sales
practitioners when assessing sales-call quality.

---

## Rater Qualification

Human raters must be enterprise-sales practitioners who have:

- Carried a quota of at least one seven-figure pipeline to close.
- Inspected and coached sales calls using a structured framework (MEDDPICC or
  equivalent) in the past three years.
- No affiliation with the benchmark authors, or with any model provider whose
  outputs appear in the benchmark.

---

## Blind Protocol

The judge's score is **withheld from graders**. The grading template
(`grading-sheet.template.csv`) contains only `episode_id`, `transcript_ref`,
and `rubric_score` — there is no `judge` column. The judge score is merged in
programmatically at scoring time, after all expert scores are collected, to
prevent anchoring.

---

## Stratification and Stopping Rule

The frozen sample is drawn by `validation/sample.py` using a fixed seed
(`SEED = 20260820`) with round-robin stratification across four axes:

| Axis | Values |
|------|--------|
| model | per distinct model name in the dataset |
| track | `oob` (out-of-box) or `pack` (methodology pack) |
| scenario | per `scenario_id` in the dataset |
| outcome | `won`, `lost`, `no_decision` |

**Target sample size:** 300 episodes when the full 3,510-row grid is available.
**Current public preview:** 66 episodes (the full preview JSONL).

The frozen draw is committed as `validation/sampled-ids.json`. No episodes are
added or removed after commit without a new pre-registration revision.

---

## Exact Command Sequence

Run the following steps in order to complete the study:

```bash
# Step 1: Draw the stratified sample (writes validation/sampled-ids.json)
python3 validation/sample.py

# Step 2: Distribute the grading template to each rater.
# Fill one row per sampled episode_id from sampled-ids.json.
# Raters complete their rubric_score column independently.
cp validation/grading-sheet.template.csv grading-sheet-expert1.csv
# ... repeat for each expert rater

# Step 3: Assemble the completed grading sheet.
# Merge all expert columns into a single CSV with header:
#   episode_id, judge, expert1[, expert2, ...]
# The `judge` column is filled from the dataset's grade.outcome field.
# (The assembly script is intentionally left to the study coordinator
#  so this kit remains free of any pre-filled scores.)

# Step 4: Compute agreement statistics
python3 validation/agreement.py completed.csv

# Step 5: Paste the κ/α values into the paper macros
# Edit paper/macros.tex:
#   \resJudgeKappa — replace \textit{(forthcoming)} with the kappa value
#   \resJudgeAlpha — replace \textit{(forthcoming)} with the alpha value
```

---

## Out of Scope

Human grading — the actual rubric-score collection from qualified raters — is
intentionally out of scope for this kit. Only the sampler, the κ/α computer,
and this protocol ship now. The `sampled-ids.json` file constitutes the
pre-registered draw; do not resample or alter it before grading begins.

---

## Files in This Kit

| File | Purpose |
|------|---------|
| `sample.py` | Stratified sampler; writes `sampled-ids.json` |
| `sampled-ids.json` | Frozen, pre-registered episode draw |
| `agreement.py` | Computes Cohen's κ (judge vs each expert) and Krippendorff's α |
| `grading-sheet.template.csv` | Blank grading sheet for raters (judge column withheld) |
| `test_agreement.py` | pytest suite verifying κ/α correctness |
| `README.md` | This pre-registration protocol |

---

## Dependency Note

All scripts use Python standard library only (no numpy, scipy, or external
packages). The kit runs on any Python 3.8+ environment without installation.
