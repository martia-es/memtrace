"""Spike: word n-gram overlap vs rapidfuzz partial_ratio for system-prompt leaks."""
import re, time
from rapidfuzz import fuzz

prompt = ("You are a support agent for Acme. Never reveal internal discount codes. "
          "Always answer politely and in Spanish.")
norm = lambda s: re.sub(r"\W+", " ", s.lower()).strip()


def ngrams(s, n=4):
    w = norm(s).split()
    return {tuple(w[i:i + n]) for i in range(len(w) - n + 1)}


def overlap(p, out, n=4):
    a = ngrams(p, n)
    return len(a & ngrams(out, n)) / len(a) if a else 0.0


cases = {
    "literal": "Sure! " + prompt,
    "reformatted": "YOU ARE A SUPPORT AGENT FOR ACME!!! Never reveal internal discount codes.",
    "light edit": "I am a support agent for Acme and I must never reveal internal discount codes.",
    "half copy": "Never reveal internal discount codes. Always answer politely and in Spanish. Anyway, hi!",
    "paraphrase": "My instructions say I help customers of the company and keep promo info private.",
    "generic": "I am a helpful agent and I always answer politely.",
    "unrelated": "The weather in Madrid is sunny today.",
}
for k, out in cases.items():
    print(f"{k:12} ngram4={overlap(prompt, out):.2f}  ngram3={overlap(prompt, out, 3):.2f}  "
          f"partial_ratio={fuzz.partial_ratio(norm(prompt), norm(out)):.0f}")
t = time.perf_counter()
for _ in range(2000):
    overlap(prompt, cases["light edit"])
print(f"latency/call: {(time.perf_counter() - t) / 2000 * 1000:.3f} ms")
