Seeds: [43, 47, 53, 59, 61]. Mean ± std over seeds. Recall / purity of the best finding per seeded mode; F6 is noise (lower is better).

| Variant | F1 rec | F2 rec | F3 rec | F4 rec | F5 rec | F5 pur | F6 rec | findings | spurious |
|---|---|---|---|---|---|---|---|---|---|
| exploratory (p-values on the search episodes) | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.93 ± 0.13 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 | 0.12 ± 0.03 | 6.40 ± 0.49 | 0.00 ± 0.00 |
| validated (30% reserved) | 1.00 ± 0.00 | 0.96 ± 0.03 | 0.90 ± 0.21 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 | 0.12 ± 0.03 | 6.40 ± 0.49 | 0.00 ± 0.00 |
| validated (50% reserved) | 1.00 ± 0.00 | 0.96 ± 0.03 | 0.90 ± 0.20 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 | 0.14 ± 0.01 | 6.40 ± 0.80 | 0.00 ± 0.00 |

Purity of the best finding, per mode (mean over seeds):

| Variant | F1 pur | F2 pur | F3 pur | F4 pur | F5 pur |
|---|---|---|---|---|---|
| exploratory (p-values on the search episodes) | 1.00 ± 0.00 | 0.85 ± 0.18 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 |
| validated (30% reserved) | 1.00 ± 0.00 | 0.85 ± 0.18 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 |
| validated (50% reserved) | 1.00 ± 0.00 | 0.85 ± 0.18 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.01 |

Outcome estimation vs. seeded ground truth (trace is `failed`):

| Signals | precision | recall | F1 | recall on silent failures (F3, F5) |
|---|---|---|---|---|
| error only | 0.85 ± 0.01 | 0.46 ± 0.01 | 0.60 ± 0.01 | 0.07 ± 0.01 |
| error + loop | 0.85 ± 0.01 | 0.46 ± 0.01 | 0.60 ± 0.01 | 0.07 ± 0.01 |
| error + loop + evaluator | 0.87 ± 0.00 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.02 |
| error + loop + feedback | 0.88 ± 0.01 | 0.75 ± 0.01 | 0.81 ± 0.00 | 0.58 ± 0.02 |
| all signals (production) | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.02 |
