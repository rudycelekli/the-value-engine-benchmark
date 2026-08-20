# VEB Leaderboard — `veb-base-540`

Generated 2026-07-21T20:19:33.090Z · cells: **540** · models: **2**

**Completion:** 540/540 cells (**100%**) · **0 remaining** · grid = 9 scenarios × 15 seeds × 2 models × 2 tracks (135/model/track).

> Pack lift is a **within-pair** estimate (same scenario+seed, pack vs oob) via seeded paired bootstrap.
> ✓ = 95% CI excludes 0 with ≥ 10 pairs; ⚠ = fewer than 10 pairs (directional only).
> SQS = 0.6·DVI + 20·price-integrity + outcome(won 20 · no-decision 6 · lost 0). All lifts are estimates, not causes.

## Standings (pooled over both tracks, by mean SQS)

| # | Model | n | SQS [95% CI] | OOB SQS | Pack SQS | Pack lift (SQS) [95% CI] | OOB win | Pack win |
|---|---|---|---|---|---|---|---|---|
| 1 | `openrouter:moonshotai/kimi-k3` | 270 | 61.6 [60, 63.2] | 60.8 | 62.4 | +1.5 [-1, 4.1] (n=135) | 4% | 4% |
| 2 | `together:thinkingmachines/inkling` | 270 | 57.8 [56.5, 59.2] | 59.2 | 56.5 | -2.8 [-5.6, 0.2] (n=135) | 2% | 2% |

## Price discipline & outcomes (by model × track)

| Model | Track | n | SQS | DVI | Win | No-dec | Discount % | Price integ. | Cleared bar |
|---|---|---|---|---|---|---|---|---|---|
| `openrouter:moonshotai/kimi-k3` | oob | 135 | 60.8 | 65 | 4% | 85% | 6.5 | 0.79 | 4% |
| `openrouter:moonshotai/kimi-k3` | pack | 135 | 62.4 | 68.4 | 4% | 90% | 8 | 0.76 | 4% |
| `together:thinkingmachines/inkling` | oob | 135 | 59.2 | 63.4 | 2% | 93% | 7.9 | 0.76 | 2% |
| `together:thinkingmachines/inkling` | pack | 135 | 56.5 | 63.4 | 2% | 87% | 12.4 | 0.64 | 2% |

## Reward standings (RL env, by track)

### PACK — ranked by avg reward

| # | Model | n | reward | resolved | bar | $/roll |
|---|---|---|---|---|---|---|
| 1 | `thinkingmachines/inkling` | 135/135 ✓ | 0.2 | 2% | 2% | $0.34 |
| 2 | `moonshotai/kimi-k3` | 135/135 ✓ | 0.197 | 4% | 4% | $2.62 |

### OOB — ranked by avg reward

| # | Model | n | reward | resolved | bar | $/roll |
|---|---|---|---|---|---|---|
| 1 | `thinkingmachines/inkling` | 135/135 ✓ | 0.19 | 2% | 2% | $0.26 |
| 2 | `moonshotai/kimi-k3` | 135/135 ✓ | 0.185 | 4% | 4% | $2.22 |

## Difficulty-tier breakdown

| Tier | Track | n | Mean SQS | Win rate |
|---|---|---|---|---|
| d1 | oob | 120 | 63.1 | 8% |
| d1 | pack | 120 | 66 | 7% |
| d2 | oob | 90 | 58.2 | 0% |
| d2 | pack | 90 | 54.8 | 0% |
| d3 | oob | 60 | 56.6 | 0% |
| d3 | pack | 60 | 53.1 | 0% |

## Overall methodology-pack lift (pooled, within-pair)

Pack − OOB mean SQS: **-0.6 [-2.6, 1.1] (n=270)**; win-rate lift **-0.4 pp** over 270 matched pairs.
