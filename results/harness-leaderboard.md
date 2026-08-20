# The Value Engine Benchmark — Leaderboard

| # | Seller | Runs | Avg SQS | Avg DVI | Wins | Avg Price Integrity | Scenarios |
|---|---|---|---|---|---|---|---|
| 1 | `scripted-disciplined` | 4 | **90.6** | 84.2 | 4/4 | 1 | logistics-saas, gen-telecom-1000 |
| 2 | `scripted-good-seller-TEST` | 2 | **80.4** | 79 | 1/2 | 1 | logistics-saas |
| 3 | `scripted-baseline` | 9 | **9.8** | 10.4 | 0/9 | 0.2 | logistics-saas, enterprise-bank, hostile-renewal, gen-telecom-1000 |

SQS = 0.6×DVI + 20×price-integrity + outcome points (won 20 · no-decision 6 · lost 0).

Failure-mode diagnostics: 5/15 graded runs carry failure-mode data → `failure-modes.md` / `failure-modes.json`.
