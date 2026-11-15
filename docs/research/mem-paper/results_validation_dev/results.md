Seeds: [7, 11, 13, 17, 19]. Mean ± std over seeds. Recall / purity of the best finding per seeded mode; F6 is noise (lower is better).

| Variant | F1 rec | F2 rec | F3 rec | F4 rec | F5 rec | F5 pur | F6 rec | findings | spurious |
|---|---|---|---|---|---|---|---|---|---|
| exploratory (p-values on the search episodes) | 1.00 ± 0.00 | 0.95 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 | 0.14 ± 0.02 | 6.20 ± 0.40 | 0.00 ± 0.00 |
| validated (30% reserved) | 1.00 ± 0.00 | 0.95 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.54 ± 0.02 | 0.14 ± 0.02 | 6.00 ± 0.00 | 0.00 ± 0.00 |
| validated (50% reserved) | 1.00 ± 0.00 | 0.95 ± 0.02 | 0.92 ± 0.15 | 0.93 ± 0.09 | 1.00 ± 0.00 | 0.54 ± 0.02 | 0.13 ± 0.03 | 6.20 ± 0.75 | 0.20 ± 0.40 |

Purity of the best finding, per mode (mean over seeds):

| Variant | F1 pur | F2 pur | F3 pur | F4 pur | F5 pur |
|---|---|---|---|---|---|
| exploratory (p-values on the search episodes) | 1.00 ± 0.00 | 0.77 ± 0.19 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.53 ± 0.02 |
| validated (30% reserved) | 1.00 ± 0.00 | 0.77 ± 0.19 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.54 ± 0.02 |
| validated (50% reserved) | 1.00 ± 0.00 | 0.82 ± 0.22 | 1.00 ± 0.00 | 0.84 ± 0.20 | 0.54 ± 0.02 |

Outcome estimation vs. seeded ground truth (trace is `failed`):

| Signals | precision | recall | F1 | recall on silent failures (F3, F5) |
|---|---|---|---|---|
| error only | 0.84 ± 0.02 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.07 ± 0.01 |
| error + loop | 0.84 ± 0.02 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.07 ± 0.01 |
| error + loop + evaluator | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |
| error + loop + feedback | 0.87 ± 0.01 | 0.75 ± 0.01 | 0.81 ± 0.01 | 0.59 ± 0.01 |
| all signals (production) | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |
