"""Agrupa las peticiones de los usuarios por significado, funde los grupos demasiado cercanos y solo usa el LLM para dar nombre.

Sustituye a «pídele al LLM que las agrupe en 10 categorías», que las solapaba: aquí los grupos salen separados por construcción
(distancia entre embeddings) y se mide cuánto cambian si se quita parte de los datos.
"""
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import adjusted_rand_score, silhouette_score

import llm

EMBED = "paraphrase-multilingual-MiniLM-L12-v2"  # las peticiones están en español
MERGE_ABOVE = 0.75  # similitud coseno entre centros de grupo a partir de la cual dos grupos se funden (a ajustar con datos)
_model = None


def _embed(phrases: list[str]) -> np.ndarray:
    global _model
    _model = _model or SentenceTransformer(EMBED)
    return _model.encode(phrases, normalize_embeddings=True)


def _cluster(X: np.ndarray, k: int) -> np.ndarray:
    return AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average").fit_predict(X)


def _best_k(X: np.ndarray) -> int:
    return max(range(4, min(13, len(X))), key=lambda k: silhouette_score(X, _cluster(X, k), metric="cosine"))


def _llm_group(templates: list[str], model: str | None) -> dict[str, str]:
    r = llm.ask_json(
        "Below are numbered message templates sent to an AI assistant (specific places, dates, units... are replaced by <type>). Group them into "
        "5 to 10 categories. Categories must differ in WHAT THE USER WANTS (not in wording, language or the specific values). For each category give a "
        'short name in Spanish (2 to 4 words, no jargon), a one-sentence definition, and the numbers of its templates. Return JSON only: '
        '{"categories": [{"name": "...", "definition": "...", "templates": [1, 2]}]}. Every template number must appear exactly once.\n'
        + "\n".join(f"{n + 1}. {t}" for n, t in enumerate(templates)), model=model)
    out = {}
    for c in r.get("categories", []):
        for n in c.get("templates", []):
            if isinstance(n, int) and 1 <= n <= len(templates):
                out.setdefault(templates[n - 1], str(c.get("name") or "Sin nombre"))
    return out


def _fill(assign: dict[str, str], templates: list[str], X: np.ndarray) -> tuple[dict[str, str], int]:
    """Lo que el LLM no asignó va a la categoría con el centro más cercano (embeddings). Devuelve también cuántas fueron."""
    out, known = dict(assign), [j for j, u in enumerate(templates) if u in assign]
    missing = 0
    for i, tpl in enumerate(templates):
        if tpl not in out and known:
            out[tpl] = assign[templates[known[int(np.argmax(X[known] @ X[i]))]]]
            missing += 1
    return out, missing


def group_templates(counts: dict[str, int], second_model: str | None = "openai/gpt-oss-120b") -> tuple[dict[str, str], dict]:
    """Plantilla -> categoría. Un LLM las agrupa viéndolas todas (con definiciones); los embeddings completan lo que se le escape
    y un segundo modelo mide si el agrupamiento es robusto (ARI ponderado por conversaciones: 1 = misma partición)."""
    templates = list(counts)
    X = _embed(templates)
    first, missing = _fill(_llm_group(templates, None), templates, X)
    q = {"categories": len(set(first.values())), "unassigned_filled": missing}
    names = sorted(set(first.values()))
    labels = np.array([names.index(first[t]) for t in templates])
    q["silhouette"] = round(float(silhouette_score(X, labels, metric="cosine")), 2) if 1 < len(names) < len(templates) else None
    if second_model:
        # (si el segundo modelo no responde, no hay medida de robustez)
        other, missing2 = _fill(_llm_group(templates, second_model), templates, X)
        if len(other) < len(templates):
            return first, q
        w = [counts[t] for t in templates]
        lab2 = {n: i for i, n in enumerate(sorted(set(other.values())))}
        q["stability_vs_other_model"] = round(float(adjusted_rand_score(np.repeat(labels, w), np.repeat([lab2[other[t]] for t in templates], w))), 2)
        q["other_model_categories"], q["other_model_unassigned"] = len(lab2), missing2
    return first, q


def group_requests(counts: dict[str, int]) -> dict[str, str]:
    """frase -> nombre de categoría."""
    phrases = list(counts)
    X = _embed(phrases)
    labels = _cluster(X, _best_k(X))
    while True:  # fusión: mientras haya dos grupos casi iguales, se juntan
        ids = sorted(set(labels))
        C = np.array([X[labels == i].mean(0) for i in ids])
        C /= np.linalg.norm(C, axis=1, keepdims=True)
        S = C @ C.T - np.eye(len(ids)) * 2
        a, b = np.unravel_index(S.argmax(), S.shape)
        if S[a, b] < MERGE_ABOVE or len(ids) <= 3:
            break
        labels[labels == ids[b]] = ids[a]
    names, used = {}, set()
    for i in sorted(set(labels)):
        top = sorted((p for p, l in zip(phrases, labels) if l == i), key=lambda p: -counts[p])[:8]
        n = str(llm.ask_json("Give a short name in Spanish (2 to 4 words, no jargon) that covers all of these user requests. "
                             'Return JSON only: {"name": "..."}.\n' + "\n".join(top)).get("name") or f"Grupo {i}")
        names[i] = n if n not in used else f"{n} ({i})"
        used.add(names[i])
    return {p: names[l] for p, l in zip(phrases, labels)}


def quality(counts: dict[str, int], grouping: dict[str, str], runs: int = 10) -> dict:
    """Estabilidad (ARI medio al quitar el 20 % de las frases; 1 = igual), silueta y nº de categorías."""
    phrases, rng = list(counts), np.random.default_rng(7)
    X = _embed(phrases)
    names = sorted(set(grouping.values()))
    base = np.array([names.index(grouping[p]) for p in phrases])
    stab = []
    for _ in range(runs):
        idx = rng.choice(len(phrases), int(len(phrases) * .8), replace=False)
        stab.append(adjusted_rand_score(base[idx], _cluster(X[idx], len(names))))
    return {"categories": len(names), "stability": round(float(np.mean(stab)), 2),
            "silhouette": round(float(silhouette_score(X, base, metric="cosine")), 2) if len(names) > 1 else None}
