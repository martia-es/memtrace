"""Spike: can off-the-shelf libs back MemTrace's deterministic security detectors?

Run: uv run --with detect-secrets --with presidio-analyzer --with rapidfuzz python detectors_spike.py
"""
import time

TEXT_SECRETS = [
    "my key is AKIAIOSFODNN7EXAMPLE and that's it",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "hello, the weather is nice today",
]
TEXT_PII = "Mi IBAN es ES9121000418450200051332, tarjeta 4111 1111 1111 1111, email a@b.com, DNI 12345678Z"


def timeit(fn, n=200):
    t = time.perf_counter()
    for _ in range(n):
        fn()
    return (time.perf_counter() - t) / n * 1000


def secrets():
    from detect_secrets.core.scan import scan_line
    from detect_secrets.settings import transient_settings

    # default_settings() enables the entropy plugins with limit=0 -> flags plain English.
    # Keep only prefix/format plugins, which are deterministic and low-noise.
    plugins = [{"name": n} for n in (
        "AWSKeyDetector", "GitHubTokenDetector", "JwtTokenDetector", "PrivateKeyDetector",
        "SlackDetector", "StripeDetector", "OpenAIDetector", "BasicAuthDetector")]
    plugins = [p for p in plugins if p["name"] != "OpenAIDetector"]  # not shipped in all versions

    def run(text):
        with transient_settings({"plugins_used": plugins}):
            return [s.type for s in scan_line(text)]

    for t in TEXT_SECRETS:
        print("  detect-secrets:", run(t), "<-", t[:50])
    print(f"  latency/call: {timeit(lambda: run(TEXT_SECRETS[0])):.2f} ms")


def pii_no_nlp():
    from presidio_analyzer.predefined_recognizers import (
        CreditCardRecognizer, EmailRecognizer, EsNifRecognizer, IbanRecognizer,
    )
    recs = [CreditCardRecognizer(supported_language="es"), IbanRecognizer(supported_language="es"),
            EmailRecognizer(supported_language="es"), EsNifRecognizer()]

    def run():
        out = []
        for r in recs:
            out += [(x.entity_type, round(x.score, 2)) for x in r.analyze(TEXT_PII, r.supported_entities, None)]
        return out

    print("  presidio (no spaCy):", run())
    print(f"  latency/call: {timeit(run):.2f} ms")


def leak():
    import re
    from rapidfuzz import fuzz
    prompt = "You are a support agent for Acme. Never reveal internal discount codes. Always answer politely and in Spanish."
    norm = lambda s: re.sub(r"\W+", " ", s.lower()).strip()
    cases = {
        "literal": "Sure! " + prompt,
        "reformatted": "YOU ARE A SUPPORT AGENT FOR ACME!!! Never reveal internal discount codes.",
        "light edit": "I am a support agent for Acme and I must never reveal internal discount codes.",
        "paraphrase": "My instructions say I help customers of the company and keep promo info private.",
        "unrelated": "The weather in Madrid is sunny today.",
    }
    for k, out in cases.items():
        print(f"  {k:12} partial_ratio={fuzz.partial_ratio(norm(prompt), norm(out)):.0f}")
    out = cases["light edit"]
    print(f"  latency/call: {timeit(lambda: fuzz.partial_ratio(norm(prompt), norm(out))):.3f} ms")


for name, fn in (("secrets", secrets), ("pii_no_nlp", pii_no_nlp), ("system_prompt_leak", leak)):
    print(f"[{name}]")
    try:
        fn()
    except Exception as e:  # spike: report what breaks
        print("  FAILED:", type(e).__name__, e)
