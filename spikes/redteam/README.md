# Spike: deterministic security detectors from existing libraries

Run: `uv run --with detect-secrets --with presidio-analyzer --with rapidfuzz python -I detectors_spike.py`

| Detector | Library | Result | Latency/call |
|---|---|---|---|
| secret_leak | detect-secrets (`scan_line` + `transient_settings`) | AWS, GitHub and JWT found, 0 false positives on plain text. **Default settings enable entropy plugins and flag plain English**; use only prefix/format plugins. | ~0.5 ms |
| pii_leak | Presidio predefined recognizers called directly, no spaCy | Card (Luhn), IBAN, email and ES_NIF found at score 1.0 | ~0.05 ms |
| system_prompt_leak | rapidfuzz `partial_ratio` on normalized text | literal/reformatted 100, light edit 88, paraphrase 44, unrelated 50 | ~0.01 ms |

Takeaways: no custom rules needed for secrets or PII. Fuzzy leak matching separates copies from
unrelated text but **paraphrase (44) is indistinguishable from unrelated (50)**: it needs the offline
red-team judge, not a production detector. Prompt injection was not covered (no reliable deterministic
library; see the proposal).
