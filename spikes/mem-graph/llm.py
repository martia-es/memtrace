"""Llamadas a un LLM (Groq, API compatible con OpenAI) con caché en disco: el grafo es reproducible y se puede reanudar.

  GROQ_API_KEY=... python build_graph.py        (modelo: GRAPH_LLM_MODEL, por defecto qwen/qwen3.8-27b)
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent / "data" / "llm_cache.jsonl"
MODEL = os.environ.get("GRAPH_LLM_MODEL", "qwen/qwen3.8-27b")
PAUSE = float(os.environ.get("GRAPH_LLM_PAUSE", "6"))  # límite gratuito de Groq: 8.000 tokens/min
_cache: dict[str, dict] = {}


def _load() -> None:
    if not _cache and CACHE.exists():
        for line in CACHE.read_text().splitlines():
            r = json.loads(line)
            _cache[r["k"]] = r["v"]


def ask_json(prompt: str) -> dict:
    """Pide un JSON al modelo; si ya se preguntó lo mismo, devuelve lo guardado."""
    _load()
    k = hashlib.sha256((MODEL + prompt).encode()).hexdigest()
    if k in _cache:
        return _cache[k]
    body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0}).encode()
    for attempt in range(6):
        req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", body,
                                     {"content-type": "application/json", "user-agent": "memtrace-spike/0",
                                      "authorization": f"Bearer {os.environ['GROQ_API_KEY']}"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                text = json.load(r)["choices"][0]["message"]["content"]
            v = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
            break
        except urllib.error.HTTPError as e:
            time.sleep(float(e.headers.get("retry-after") or 30 * (attempt + 1)) + 2)
        except (ValueError, AttributeError):
            v = {}
            break
    else:
        raise RuntimeError("el proveedor no responde")
    CACHE.parent.mkdir(exist_ok=True)
    with CACHE.open("a") as f:
        f.write(json.dumps({"k": k, "v": v}, ensure_ascii=False) + "\n")
    _cache[k] = v
    time.sleep(PAUSE)
    return v
