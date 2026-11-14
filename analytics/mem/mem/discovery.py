"""Descubrimiento (Fase 2.1): reglas que explican los fallos recurrentes de un agente, con significación estadística.

Lógica pura sobre un DataFrame de episodios; no sabe de ClickHouse. Portada del spike `spikes/mem/discover.py`:

1. Rasgos generados solos para cualquier agente: contexto (atributos con pocos valores, modelo, versión de prompt, grupo
   de objetivo) y conducta (cuántas veces se llama a cada paso, qué paso va antes que cuál, repeticiones, argumentos vacíos).
   Nada de nombres de herramientas, de ciudades ni de fallos escritos a mano.
2. Los fallos se separan primero por lo que muestran (paso que falla y error); los silenciosos van juntos.
3. Por cada causa, «cobertura secuencial»: un árbol poco profundo busca la condición más significativa, se retiran los
   fallos que explica y se repite sobre lo que queda. Cada regla pasa un test exacto de Fisher con corrección de Bonferroni.
4. Se simplifican las reglas, se unen las que describen lo mismo y se mide cuánto de cada una ocurre por versión de prompt
   (así se ve si un fallo ya se corrigió).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd
from scipy.stats import fisher_exact
from sklearn.tree import DecisionTreeClassifier, _tree

DISCOVERY_VERSION = 1


@dataclass(frozen=True)
class Config:
    min_support: int = 30  # como el aviso de muestra pequeña de ADR-069
    min_lift: float = 1.5
    alpha: float = 0.01
    max_rules: int = 12
    max_attr_values: int = 20  # un atributo con más valores distintos no es contexto, es un identificador
    min_episodes: int = 200  # por debajo no hay muestra para que un test estadístico signifique algo
    tree_depth: int = 3


@dataclass
class Finding:
    cause: str
    rule: str
    support: int
    failures: int
    failure_rate: float
    lift: float
    p_value: float
    decisive_step: str
    decisive_error: str
    tool_sequence: str
    occurrence_by_prompt: dict[str, float]
    members: list[str] = field(repr=False, default_factory=list)  # trazas que cumplen la regla
    example_trace_ids: list[str] = field(default_factory=list)
    merged_rules: list[str] = field(default_factory=list)

    @property
    def finding_id(self) -> str:
        """Estable entre pasadas: misma causa y misma regla, mismo id."""
        return hashlib.sha1(f"{self.cause}\x00{self.rule}".encode()).hexdigest()[:16]


@dataclass
class Discovery:
    findings: list[Finding]
    episodes: int
    failed: int
    unexplained: int
    unexplained_top: dict[str, int]
    goal_clusters: int


# ---------- rasgos ----------

def _longest_run(steps: list[str]) -> int:
    best = run = 0
    prev = None
    for x in steps:
        run = run + 1 if x == prev else 1
        prev = x
        best = max(best, run)
    return best


def build_features(df: pd.DataFrame, k: int, cfg: Config = Config()) -> pd.DataFrame:
    """Rasgos de cada episodio. `df` trae `attrs` (dict), `steps` (str con «>»), `empty_arg_tools` (str con «,») y,
    si hay agrupación de objetivos, `goal_cluster` (entero)."""
    features: dict[str, pd.Series] = {}
    attrs = pd.DataFrame(df["attrs"].tolist(), index=df.index).fillna("")
    for col in attrs.columns:
        if attrs[col].nunique() <= cfg.max_attr_values:
            for v in sorted(attrs[col].unique()):
                features[f"{col}={v}"] = (attrs[col] == v).astype(int)
    for c in range(k):
        features[f"goal_cluster={c}"] = (df["goal_cluster"] == c).astype(int)

    steps = df["steps"].map(lambda s: s.split(">") if s else [])
    names = sorted({n for s in steps for n in s})
    for n in names:
        features[f"count:{n}"] = steps.map(lambda s, n=n: s.count(n))
    tools = [n for n in names if n != "chat"]
    for a in tools:
        for b in tools:
            if a != b:
                features[f"{a}_before_{b}"] = steps.map(lambda s, a=a, b=b: int(a in s and b in s and s.index(a) < s.index(b)))
        features[f"empty_arg:{a}"] = df["empty_arg_tools"].map(lambda e, a=a: int(a in e.split(",")))
    features["max_repeat_of_a_step"] = steps.map(_longest_run)
    features["n_steps"] = steps.map(len)
    if "goal" in df:
        # cuántas entidades (nombres propios, cifras) menciona la petición: «compara A y B» pide dos, y no depende de la agrupación
        features["goal_entities"] = df["goal"].map(lambda g: mask_goal(g).count("<name>") + mask_goal(g).count("<n>"))
    return pd.DataFrame(features, index=df.index)


# ---------- reglas ----------

def describe(path: list[tuple[str, str, float]]) -> str:
    return " AND ".join(f"{n} {op} {thr:g}" for n, op, thr in path)


def _leaf_rules(tree: DecisionTreeClassifier, names: list[str]) -> list[dict]:
    t = tree.tree_
    rules: list[dict] = []

    def walk(node: int, path: list) -> None:
        if t.feature[node] == _tree.TREE_UNDEFINED:
            rules.append({"path": path, "n": int(t.n_node_samples[node])})
            return
        name, thr = names[t.feature[node]], t.threshold[node]
        walk(t.children_left[node], path + [(name, "<=", thr)])
        walk(t.children_right[node], path + [(name, ">", thr)])

    walk(0, [])
    return rules


def _mask(X: pd.DataFrame, path: list) -> np.ndarray:
    m = np.ones(len(X), dtype=bool)
    for name, op, thr in path:
        m &= (X[name] <= thr).values if op == "<=" else (X[name] > thr).values
    return m


def _best_rule(X: pd.DataFrame, y: pd.Series, train: np.ndarray, cfg: Config):
    """Hoja más significativa de un árbol sobre lo que aún no explica ninguna regla."""
    Xt, yt = X[train], y[train]
    tree = DecisionTreeClassifier(max_depth=cfg.tree_depth, min_samples_leaf=cfg.min_support, random_state=0).fit(Xt, yt)
    base = yt.mean()
    cands = []
    for r in _leaf_rules(tree, list(X.columns)):
        if r["n"] < cfg.min_support or not r["path"]:
            continue
        m = _mask(Xt, r["path"])
        a, b = int(yt[m].sum()), int((1 - yt[m]).sum())
        c, d = int(yt[~m].sum()), int((1 - yt[~m]).sum())
        _, p = fisher_exact([[a, b], [c, d]], alternative="greater")
        lift = (a / max(a + b, 1)) / base if base else 0
        if lift >= cfg.min_lift:
            cands.append((p, r, lift))
    if not cands:
        return None
    cands.sort(key=lambda t: t[0])
    return cands[0], len(cands)


def _generalize(X: pd.DataFrame, y: pd.Series, path: list, cfg: Config) -> list:
    """Quita condiciones que no aportan: la regla más corta con casi la misma precisión explica más y se entiende mejor."""

    def prec(p: list) -> tuple[float, int]:
        m = _mask(X, p)
        return (y[m].mean() if m.any() else 0.0), int(m.sum())

    base_p, _ = prec(path)
    path = list(path)
    changed = True
    while changed and len(path) > 1:
        changed = False
        for c in list(path):
            trial = [x for x in path if x is not c]
            p, n = prec(trial)
            if p >= 0.95 * base_p and n >= cfg.min_support:
                path, changed = trial, True
                break
    return path


def _top(series: pd.Series) -> str:
    counts = series.replace("", "(sin error)").value_counts()
    return str(counts.index[0]) if len(counts) else ""


def _merge_overlapping(findings: list[dict]) -> list[dict]:
    """Dos reglas de la misma causa que explican casi los mismos fallos son una sola: se queda la que explica más."""
    kept: list[dict] = []
    for f in sorted(findings, key=lambda f: -f["failures"]):
        mine = set(f["fail_ids"])
        for k in kept:
            theirs = set(k["fail_ids"])
            if k["cause"] == f["cause"] and len(mine & theirs) / max(len(mine | theirs), 1) >= 0.5:
                k["merged_rules"].append(f["rule"])
                break
        else:
            kept.append(f)
    return kept


def _signature(f: dict) -> tuple:
    """Dos reglas describen el mismo fallo si se rompen en el mismo paso, con el mismo error y la misma secuencia."""
    behaviour = tuple(sorted(c[0] for c in f["path"] if not c[0].startswith(("goal_cluster", "user.lang="))))
    return (f["decisive_step"], f["decisive_error"], f["tool_sequence"], behaviour)


def _merge_duplicates(df: pd.DataFrame, findings: list[dict]) -> list[dict]:
    groups: dict[tuple, list[dict]] = {}
    for f in findings:
        groups.setdefault(_signature(f), []).append(f)
    merged = []
    for fs in groups.values():
        main = dict(max(fs, key=lambda f: f["support"]))
        if len(fs) > 1:
            ids = sorted({t for f in fs for t in f["members"]})
            sub = df[df.trace_id.isin(ids)]
            main["rule"] = " | ".join(f["rule"] for f in fs)
            main["members"] = ids
            main["support"] = len(ids)
            main["failures"] = int((sub.outcome == "failed").sum())
            main["failure_rate"] = round(float((sub.outcome == "failed").mean()), 3)
            main["merged_rules"] = sorted({r for f in fs for r in [f["rule"], *f["merged_rules"]]} - {main["rule"]})
        merged.append(main)
    return merged


def discover(df: pd.DataFrame, cfg: Config = Config(), goal_labels: pd.Series | None = None, goal_k: int = 0) -> Discovery:
    """Busca reglas sobre los episodios de un agente. `df` necesita: trace_id, outcome, has_error, decisive_step,
    decisive_error, steps, tools, attrs, empty_arg_tools y prompt_version. `goal_labels` es opcional."""
    df = df.reset_index(drop=True)
    df["goal_cluster"] = goal_labels.reset_index(drop=True) if goal_labels is not None else 0
    failed_all = (df["outcome"] == "failed").values
    n_failed = int(failed_all.sum())
    if len(df) < cfg.min_episodes or n_failed < cfg.min_support:
        return Discovery([], len(df), n_failed, n_failed, {}, goal_k)

    X = build_features(df, goal_k, cfg)
    # los fallos con error se separan por lo que muestran; los silenciosos van juntos
    cause = pd.Series(np.where(failed_all, df.apply(
        lambda r: f"{r.decisive_step} | {r.decisive_error}" if r.has_error else "(sin error)", axis=1), ""), index=df.index)
    sizes = cause[cause != ""].value_counts()
    versions = sorted(df["prompt_version"].astype(str).unique())

    raw: list[dict] = []
    for g in [c for c, n in sizes.items() if n >= cfg.min_support]:
        y = (cause == g).astype(int)
        train = ~(failed_all & (cause != g).values)  # los fallos de otras causas no cuentan como «no fallo»
        for _ in range(cfg.max_rules):
            found = _best_rule(X, y, train, cfg)
            if not found:
                break
            (p, r, lift), n_candidates = found
            if p * n_candidates > cfg.alpha:  # Bonferroni dentro de la ronda
                break
            path = _generalize(X, y, r["path"], cfg)
            m = _mask(X, path)
            members, fail_members = df[m], df[m][cause[m] == g]
            if len(fail_members) < cfg.min_support:  # pocos fallos reales: una coincidencia, no un patrón
                break
            raw.append({
                "path": path, "cause": g, "rule": describe(path), "support": int(m.sum()), "failures": int(len(fail_members)),
                "failure_rate": round(float(y[m].mean()), 3), "lift": round(lift, 2), "p_value": float(p),
                "decisive_step": _top(fail_members["decisive_step"]), "decisive_error": _top(fail_members["decisive_error"]),
                "tool_sequence": _top(fail_members["tools"]), "members": members["trace_id"].tolist(),
                "fail_ids": fail_members["trace_id"].tolist(), "merged_rules": [],
                "occurrence_by_prompt": {
                    v: round(100 * float((members.prompt_version.astype(str) == v).sum()) / max(int((df.prompt_version.astype(str) == v).sum()), 1), 2)
                    for v in versions},
                "example_trace_ids": fail_members["trace_id"].head(3).tolist(),
            })
            train &= ~(m & (y.values == 1))  # se retiran los fallos ya explicados

    raw = _merge_duplicates(df, _merge_overlapping(raw))
    covered = np.zeros(len(df), dtype=bool)
    for f in raw:
        covered |= df["trace_id"].isin(f["members"]).values
    resid = df[(df.outcome == "failed") & ~covered]
    top = resid["decisive_error"].replace("", "(sin error)").value_counts().head(3)
    findings = [Finding(**{k: v for k, v in f.items() if k not in ("path", "fail_ids")}) for f in raw]
    return Discovery(findings, len(df), n_failed, int(len(resid)), {str(k): int(v) for k, v in top.items()}, goal_k)


# ---------- agrupación de objetivos (opcional) ----------

Embedder = Callable[[list[str]], np.ndarray]


def mask_goal(text: str) -> str:
    """Las entidades cambian el texto sin cambiar la intención: números y nombres propios se enmascaran antes de embeber."""
    text = re.sub(r"\b\d+([.,]\d+)?\b", "<n>", text)
    # palabra con mayúscula inicial que no abre la frase ni va tras un signo de apertura: probablemente un nombre propio
    return re.sub(r"(?<=[\wáéíóúñü,;] )[A-ZÁÉÍÓÚÑ][\wáéíóúñü]+", "<name>", text)


def cluster_goals(goals: pd.Series, embed: Embedder, kmin: int = 3, kmax: int = 14, seed: int = 0) -> tuple[pd.Series, int, float]:
    """Agrupa los objetivos por significado: el grupo con mejor silueta entre kmin y kmax. Devuelve (etiquetas, k, silueta)."""
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    uniq = goals.unique().tolist()
    masked = [mask_goal(g) for g in uniq]
    uniq_masked = sorted(set(masked))
    if len(uniq_masked) <= kmin:
        return pd.Series(0, index=goals.index), 0, 0.0
    emb = embed(uniq_masked)
    best, best_k, labels = -1.0, 0, None
    for k in range(kmin, min(kmax, len(uniq_masked) - 1) + 1):
        km = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(emb)
        s = silhouette_score(emb, km.labels_)
        if s > best:
            best, best_k, labels = s, k, km.labels_
    by_masked = dict(zip(uniq_masked, labels))
    mapping = {g: int(by_masked[m]) for g, m in zip(uniq, masked)}
    return goals.map(mapping), best_k, float(best)


def sentence_transformers_embedder(model: str = "paraphrase-multilingual-MiniLM-L12-v2") -> Embedder:
    """Embeddings locales y multilingües (sin llamar a ningún proveedor). Importa tarde: es la dependencia pesada."""
    from sentence_transformers import SentenceTransformer

    encoder = SentenceTransformer(model)
    return lambda texts: encoder.encode(texts, normalize_embeddings=True, show_progress_bar=False)
