Seeds: [23, 29, 31, 37, 41]. Mean ± std over seeds. Recall / purity of the best finding per seeded mode; F6 is noise (lower is better).

| Variant | F1 rec | F2 rec | F3 rec | F4 rec | F5 rec | F5 pur | F6 rec | findings | spurious |
|---|---|---|---|---|---|---|---|---|---|
| v2 (no mitigation) | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.86 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 | 0.15 ± 0.07 | 6.20 ± 0.40 | 0.20 ± 0.40 |
| + support cap (<= 25% of episodes) | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.86 ± 0.17 | 0.96 ± 0.09 | 0.81 ± 0.38 | 0.42 ± 0.19 | 0.10 ± 0.04 | 5.80 ± 0.98 | 0.00 ± 0.00 |
| + min precision (>= 0.15) | 1.00 ± 0.00 | 0.94 ± 0.02 | 0.86 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 | 0.15 ± 0.07 | 6.40 ± 0.49 | 0.20 ± 0.40 |
| + family-wise Bonferroni | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.86 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 | 0.15 ± 0.07 | 6.20 ± 0.40 | 0.20 ± 0.40 |
| + all three | 1.00 ± 0.00 | 0.94 ± 0.02 | 0.86 ± 0.17 | 0.96 ± 0.09 | 0.81 ± 0.38 | 0.42 ± 0.19 | 0.10 ± 0.04 | 6.00 ± 1.10 | 0.00 ± 0.00 |

Purity of the best finding, per mode (mean over seeds):

| Variant | F1 pur | F2 pur | F3 pur | F4 pur | F5 pur |
|---|---|---|---|---|---|
| v2 (no mitigation) | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| + support cap (<= 25% of episodes) | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 0.91 ± 0.18 | 0.42 ± 0.19 |
| + min precision (>= 0.15) | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| + family-wise Bonferroni | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| + all three | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.91 ± 0.18 | 0.42 ± 0.19 |

Outcome estimation vs. seeded ground truth (trace is `failed`):

| Signals | precision | recall | F1 | recall on silent failures (F3, F5) |
|---|---|---|---|---|
| error only | 0.84 ± 0.00 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.06 ± 0.01 |
| error + loop | 0.84 ± 0.00 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.06 ± 0.01 |
| error + loop + evaluator | 0.87 ± 0.00 | 0.85 ± 0.01 | 0.86 ± 0.00 | 0.72 ± 0.01 |
| error + loop + feedback | 0.87 ± 0.01 | 0.74 ± 0.02 | 0.80 ± 0.01 | 0.57 ± 0.02 |
| all signals (production) | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |
