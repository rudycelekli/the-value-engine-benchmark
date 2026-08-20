# VEB Fine-Tune Lift — Base-Arm Report

> **Study:** open-weight fine-tune lift on the Value Engine Benchmark
> **Design:** 2×2 — {base, fine-tuned} × {out-of-box, +Value-Engine pack}
> **This report covers:** the **base arms only** (base × oob, base × pack).
> The fine-tuned arms are pending (see [What's next](#8-whats-next)).
> **Status:** base grid **locked & verified clean** · **Date:** 2026-07-21

---

## 1. Why this study exists

The public [VEB leaderboard](https://thevalueengine.ai/benchmark) scores **production
frontier endpoints** — proprietary models as each lab exposes them, no fine-tuned
checkpoints. This study answers the adjacent, product-critical question:

> Can we take an **open-weight** model and make it a better *seller* — first by
> injecting the Value Engine methodology as a prompt-time asset pack, and then by
> **fine-tuning** it on the discipline the benchmark rewards?

Two open models are the substrate:

| Model | Route | Role |
|---|---|---|
| **Kimi-K3** | `openrouter:moonshotai/kimi-k3` | FT candidate A (frontier-class open) |
| **Inkling** | `together:thinkingmachines/inkling` | FT candidate B (small, cheap open) |

The 2×2 isolates two levers independently: **pack** (prompt-time methodology) and
**fine-tune** (weights). This report establishes the **base-arm floor** both levers
are measured against.

---

## 2. Provenance (verified clean)

- **540 cells** — 2 models × 9 scenarios × 15 seeds × 2 tracks (135 per model per track).
- **Completion:** 540/540 (**100%**), 0 remaining.
- **Cleanliness:** **0 heuristic cells** — every cell is a genuine complete LLM-graded
  episode (`judge == 'llm'`), verified not just against the dirty-flag audit but for
  full-response completeness. 3 latent heuristic-fallback cells found in Inkling during
  the deep audit were re-graded in place (trajectory preserved) before the lock.
- **Judge:** default panel judge (`anthropic:claude-sonnet-4-6`), identical across all
  540 cells — no mid-grid judge change.
- **SQS** = 0.6·DVI + 20·price-integrity + outcome (won 20 · no-decision 6 · lost 0).
- **CIs:** seeded paired bootstrap; pack lift is a **within-pair** estimate (same
  scenario+seed, pack vs oob). ✓ = 95% CI excludes 0 with ≥ 10 pairs.
- **Export:** `benchmark/exports/veb-base-540/leaderboard.{md,json}`, generated
  2026-07-21T20:19:33Z.

---

## 3. Headline

**On un-tuned open models, the prompt-time pack does not reliably move the number.**

Pooled within-pair pack lift across both models is **−0.6 SQS [−2.6, 1.1] (n=270
pairs)** — a null result (CI spans 0). Per model it is directional and mixed: **Kimi
+1.5 [−1.0, 4.1]** (not significant), **Inkling −2.8 [−5.6, 0.2]** (not significant).

This is the expected, honest floor: **methodology injected as text does not, on its
own, retune an open model's selling behavior.** It sets up the real hypothesis — that
the lever is **weights, not prompt** — which the fine-tuned arms test next.

Both base models sit at **SQS ~58–62** and **win 2–4%** of deals: fluent, and — like
every frontier model on the public board — structurally unable to close. They fail the
same way (see §6).

---

## 4. Standings — pooled over both tracks, by mean SQS

| # | Model | n | SQS [95% CI] | OOB SQS | Pack SQS | Pack lift (SQS) [95% CI] | Win |
|---|---|---|---|---|---|---|---|
| 1 | Kimi-K3 | 270 | **61.6** [60.0, 63.2] | 60.8 | 62.4 | +1.5 [−1.0, 4.1] (n=135) | 4% |
| 2 | Inkling | 270 | **57.8** [56.5, 59.2] | 59.2 | 56.5 | −2.8 [−5.6, 0.2] (n=135) | 2% |

Overlapping-adjacent but distinct: Kimi-K3's CI lower bound (60.0) sits above Inkling's
upper bound (59.2), so Kimi-K3 ranks ahead on base SQS.

---

## 5. Price discipline & outcomes — by model × track

| Model | Track | n | SQS | DVI | Win | No-dec | Discount % | Price integ. | Cleared bar |
|---|---|---|---|---|---|---|---|---|---|
| Kimi-K3 | oob | 135 | 60.8 | 65.0 | 4% | 85% | 6.5 | 0.79 | 4% |
| Kimi-K3 | pack | 135 | 62.4 | 68.4 | 4% | 90% | 8.0 | 0.76 | 4% |
| Inkling | oob | 135 | 59.2 | 63.4 | 2% | 93% | 7.9 | 0.76 | 2% |
| Inkling | pack | 135 | 56.5 | 63.4 | 2% | 87% | 12.4 | 0.64 | 2% |

**Read:** the pack nudges Kimi-K3's *discovery value* up (DVI 65 → 68.4) but the effect
washes out at the outcome layer (win rate flat at 4%). On Inkling the pack is actively
counterproductive on **price discipline** — discount rate nearly doubles (7.9 → 12.4)
and price integrity drops (0.76 → 0.64), dragging pack SQS *below* its own oob. A
smaller model given more methodology to juggle **talks more and holds price less** — a
concrete argument for teaching the discipline in the weights rather than the prompt.

---

## 6. RL-env view — reward & cost, by track

Same grid read as a verifiable RL environment (reward on [0,1], bar = oracle-clear).

| Track | Model | n | reward | resolved | cleared bar | $/roll |
|---|---|---|---|---|---|---|
| PACK | Inkling | 135/135 ✓ | 0.200 | 2% | 2% | **$0.34** |
| PACK | Kimi-K3 | 135/135 ✓ | 0.197 | 4% | 4% | $2.62 |
| OOB | Inkling | 135/135 ✓ | 0.190 | 2% | 2% | **$0.26** |
| OOB | Kimi-K3 | 135/135 ✓ | 0.185 | 4% | 4% | $2.22 |

**Cost is the story here.** Inkling delivers statistically indistinguishable reward to
Kimi-K3 at **~8× lower cost per rollout** ($0.26–0.34 vs $2.22–2.62). For the
fine-tune target that matters: **Inkling is the cheap, dense substrate to teach**, and
any FT lift on it compounds against an already-favorable cost basis.

---

## 7. Difficulty-tier breakdown

| Tier | Track | n | Mean SQS | Win rate |
|---|---|---|---|---|
| d1 | oob | 120 | 63.1 | 8% |
| d1 | pack | 120 | 66.0 | 7% |
| d2 | oob | 90 | 58.2 | 0% |
| d2 | pack | 90 | 54.8 | 0% |
| d3 | oob | 60 | 56.6 | 0% |
| d3 | pack | 60 | 53.1 | 0% |

Any signal the pack has lives entirely in the **easy tier (d1)**; on d2/d3 the pack is
flat-to-negative and win rate is **0% across the board**. The hard scenarios
(hostile-renewal, procurement-gated) are where base open models — packed or not —
simply cannot win. That is precisely the band a fine-tune has to move to matter.

---

## 8. What's next

1. **Fine-tuned arms.** The TRAIN-split winners are **already distilled** — the
   oob-framed training export is built and verified (**38,416 SFT + 17,064 DPO**,
   `benchmark/exports/veb-ft/`). What remains is to fine-tune Inkling on it and re-run
   base×FT and pack×FT on the identical 9×15 grid (lift = FT − base, within-pair).
   Training data, real cost (~$5.4K default, with cheaper levers), and the Tinker
   access status (valid key; **billing-blocked**) are in
   `docs/VEB-FT-EXECUTION-RUNBOOK.md`.
2. **Uniform re-grade.** When the FT arms land, re-grade **all** arms under the hardened
   judge (retry+timeout, `env_internal_failure` honesty flag) — never a partial mix of
   old-judge and new-judge cells. Design in `docs/VEB-JUDGE-HARDENING-PLAN.md`.
3. **Publication gate.** These base arms are a **floor, not a headline** — they stay in
   this report and do **not** go on the public frontier leaderboard, which is
   deliberately scoped to production endpoints. The FT result graduates to the public
   page only once the FT arm exists and the whole 2×2 is graded uniformly.

---

## Appendix — one-line takeaways

- Prompt-time pack ≈ **no reliable lift** on un-tuned open models (pooled −0.6 [−2.6, 1.1]).
- On the small model the pack **hurts price discipline** (discount 7.9→12.4, PI 0.76→0.64).
- Inkling ≈ Kimi-K3 reward at **~8× lower cost** → the FT target.
- Base open models win **2–4%**, **0%** on hard tiers — same failure shape as the frontier.
- Lever under test is **weights, not prompt.** Fine-tune arms pending — training
  export built & verified; execution gated only on Tinker billing (see runbook).
