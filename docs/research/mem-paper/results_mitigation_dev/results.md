Seeds: [7, 11, 13, 17, 19]. Mean ± std over seeds. Recall / purity of the best finding per seeded mode; F6 is noise (lower is better).

| Variant | F1 rec | F2 rec | F3 rec | F4 rec | F5 rec | F5 pur | F6 rec | findings | spurious |
|---|---|---|---|---|---|---|---|---|---|
| v2 (no mitigation) | 1.00 ± 0.00 | 0.95 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.24 ± 0.13 | 7.00 ± 1.55 | 0.80 ± 1.17 |
| + support cap (<= 25% of episodes) | 1.00 ± 0.00 | 0.95 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.17 ± 0.07 | 6.40 ± 0.49 | 0.20 ± 0.40 |
| + min precision (>= 0.15) | 1.00 ± 0.00 | 0.94 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.14 ± 0.02 | 6.20 ± 0.40 | 0.00 ± 0.00 |
| + family-wise Bonferroni | 1.00 ± 0.00 | 0.95 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.14 ± 0.02 | 6.20 ± 0.40 | 0.00 ± 0.00 |
| + all three | 1.00 ± 0.00 | 0.94 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.14 ± 0.02 | 6.20 ± 0.40 | 0.00 ± 0.00 |

Purity of the best finding, per mode (mean over seeds):

| Variant | F1 pur | F2 pur | F3 pur | F4 pur | F5 pur |
|---|---|---|---|---|---|
| v2 (no mitigation) | 1.00 ± 0.00 | 0.77 ± 0.19 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |
| + support cap (<= 25% of episodes) | 1.00 ± 0.00 | 0.77 ± 0.19 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |
| + min precision (>= 0.15) | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |
| + family-wise Bonferroni | 1.00 ± 0.00 | 0.77 ± 0.19 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |
| + all three | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |

Outcome estimation vs. seeded ground truth (trace is `failed`):

| Signals | precision | recall | F1 | recall on silent failures (F3, F5) |
|---|---|---|---|---|
| error only | 0.84 ± 0.02 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.07 ± 0.01 |
| error + loop | 0.84 ± 0.02 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.07 ± 0.01 |
| error + loop + evaluator | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |
| error + loop + feedback | 0.87 ± 0.01 | 0.75 ± 0.01 | 0.81 ± 0.01 | 0.59 ± 0.01 |
| all signals (production) | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |
