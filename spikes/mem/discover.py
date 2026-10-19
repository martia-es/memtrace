"""Pasos 5 a 7 del diseño: agrupar objetivos, minar reglas que explican los fallos y comprobar que no son ruido.

No lee ground_truth.json ni el atributo `intent`. La intención se deduce agrupando los
objetivos (mensajes del usuario) con embeddings multilingües locales.

Las reglas se extraen por «cobertura secuencial»: un árbol poco profundo busca la condición
más significativa, se retiran los fallos que explica y se repite sobre lo que queda.
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import fisher_exact
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.tree import DecisionTreeClassifier, _tree

HERE = Path(__file__).parent
OUT = HERE / "out"
MIN_SUPPORT = 30  # como el aviso de muestra pequeña de ADR-069
MIN_LIFT = 1.5
ALPHA = 0.01
MAX_RULES = 12
KMAX = 14
MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
CITIES = r"\b(Madrid|Paris|London|Rome|Berlin|Lisbon|Girona|Bilbao|Porto|Lyon|Turin|Leeds)\b"


def goal_clusters(goals: pd.Series, kmin=3, kmax=KMAX, seed=0):
    from sentence_transformers import SentenceTransformer

    uniq = goals.unique().tolist()
    # las ciudades cambian el texto sin cambiar la intención: se enmascaran antes de embeber
    masked = [re.sub(CITIES, "<city>", g) for g in uniq]
    uniq_masked = sorted(set(masked))
    emb = SentenceTransformer(MODEL).encode(uniq_masked, normalize_embeddings=True, show_progress_bar=False)
    best, best_k, labels = -1, None, None
    for k in range(kmin, min(kmax, len(uniq_masked) - 1) + 1):
        km = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(emb)
        s = silhouette_score(emb, km.labels_)
        if s > best:
            best, best_k, labels = s, k, km.labels_
    by_masked = dict(zip(uniq_masked, labels))
    mapping = {g: int(by_masked[m]) for g, m in zip(uniq, masked)}
    return goals.map(mapping), best_k, best


def features(df: pd.DataFrame, k: int) -> pd.DataFrame:
    """Rasgos generados automáticamente para cualquier agente, sin nombres de herramientas ni de fallos escritos a mano.

    - contexto: cada atributo de la traza con pocos valores distintos (idioma, modelo, versión de prompt...) y el grupo de objetivo
    - conducta: cuántas veces se llama a cada paso, qué paso va antes que cuál, repeticiones seguidas y argumentos vacíos
    """
    X = pd.DataFrame(index=df.index)
    attrs = pd.DataFrame(df["attrs"].tolist(), index=df.index)
    for col in attrs.columns:
        if attrs[col].nunique() <= 20:
            for v in sorted(attrs[col].unique()):
                X[f"{col}={v}"] = (attrs[col] == v).astype(int)
    for c in range(k):
        X[f"goal_cluster={c}"] = (df["goal_cluster"] == c).astype(int)

    steps = df["steps"].map(lambda s: s.split(">") if s else [])
    names = sorted({n for s in steps for n in s})
    for n in names:
        X[f"count:{n}"] = steps.map(lambda s: s.count(n))
    tools = [n for n in names if n != "chat"]
    for a in tools:
        for b in tools:
            if a != b:
                X[f"{a}_before_{b}"] = steps.map(lambda s: int(a in s and b in s and s.index(a) < s.index(b)))
        X[f"empty_arg:{a}"] = df["empty_arg_tools"].map(lambda e: int(a in e.split(",")))

    def longest_run(s):
        best = run = 0
        prev = None
        for x in s:
            run = run + 1 if x == prev else 1
            prev = x
            best = max(best, run)
        return best

    X["max_repeat_of_a_step"] = steps.map(longest_run)
    X["n_steps"] = steps.map(len)
    return X


def describe(path):
    return " AND ".join(f"{n} {op} {thr:g}" for n, op, thr in path)


def leaf_rules(tree, names):
    t = tree.tree_
    rules = []

    def walk(node, path):
        if t.feature[node] == _tree.TREE_UNDEFINED:
            rules.append({"path": path, "n": int(t.n_node_samples[node])})
            return
        name, thr = names[t.feature[node]], t.threshold[node]
        walk(t.children_left[node], path + [(name, "<=", thr)])
        walk(t.children_right[node], path + [(name, ">", thr)])

    walk(0, [])
    return rules


def mask_for(X, path):
    m = np.ones(len(X), dtype=bool)
    for name, op, thr in path:
        m &= (X[name] <= thr).values if op == "<=" else (X[name] > thr).values
    return m


def best_rule(X, y, train_mask):
    """Hoja más significativa de un árbol sobre lo que aún no explica ninguna regla."""
    Xt, yt = X[train_mask], y[train_mask]
    tree = DecisionTreeClassifier(max_depth=3, min_samples_leaf=MIN_SUPPORT, random_state=0).fit(Xt, yt)
    base = yt.mean()
    cands = []
    for r in leaf_rules(tree, list(X.columns)):
        if r["n"] < MIN_SUPPORT or not r["path"]:
            continue
        m = mask_for(Xt, r["path"])
        a, b = int(yt[m].sum()), int((1 - yt[m]).sum())
        c, d = int(yt[~m].sum()), int((1 - yt[~m]).sum())
        _, p = fisher_exact([[a, b], [c, d]], alternative="greater")
        lift = (a / max(a + b, 1)) / base if base else 0
        if lift >= MIN_LIFT:
            cands.append((p, r, lift))
    if not cands:
        return None
    cands.sort(key=lambda t: t[0])
    return cands[0], len(cands)


def generalize(X, y, path):
    """Quita condiciones que no aportan: la regla más corta con casi la misma precisión explica más y se entiende mejor."""
    def prec(p):
        m = mask_for(X, p)
        return (y[m].mean() if m.any() else 0.0), int(m.sum())

    base_p, _ = prec(path)
    path = list(path)
    changed = True
    while changed and len(path) > 1:
        changed = False
        for c in list(path):
            trial = [x for x in path if x is not c]
            p, n = prec(trial)
            if p >= 0.95 * base_p and n >= MIN_SUPPORT:
                path, changed = trial, True
                break
    return path


def signature(df, f):
    """Dos reglas describen el mismo fallo si se rompen en el mismo paso, con el mismo error y la misma secuencia."""
    step = next(iter(f["decisive_step"]), "")
    err = next(iter(f["decisive_error"]), "")
    seq = next(iter(f["tool_sequences"]), "")
    behaviour = tuple(sorted(c[0] for c in f["path"] if not c[0].startswith(("goal_cluster", "user.lang="))))
    return (step, err, seq, behaviour)


def merge_duplicates(df, findings):
    groups = {}
    for f in findings:
        groups.setdefault(signature(df, f), []).append(f)
    merged = []
    for fs in groups.values():
        if len(fs) == 1:
            merged.append(fs[0])
            continue
        ids = sorted({t for f in fs for t in f["members"]})
        main_f = dict(max(fs, key=lambda f: f["support"]))
        sub = df[df.trace_id.isin(ids)]
        main_f["rule"] = " | ".join(f["rule"] for f in fs)
        main_f["members"] = ids
        main_f["support"] = len(ids)
        main_f["failures"] = int((sub.outcome == "failed").sum())
        main_f["failure_rate"] = round(float((sub.outcome == "failed").mean()), 3)
        main_f["merged_from"] = len(fs)
        merged.append(main_f)
    return merged


def merge_overlapping(findings):
    """Dos reglas de la misma causa que explican casi los mismos fallos son una sola: se queda la que explica más."""
    kept = []
    for f in sorted(findings, key=lambda f: -f["failures"]):
        mine = set(f["fail_ids"])
        for k_ in kept:
            theirs = set(k_["fail_ids"])
            if k_["cause"] == f["cause"] and len(mine & theirs) / max(len(mine | theirs), 1) >= 0.5:
                k_.setdefault("also_matches", []).append(f["rule"])
                break
        else:
            kept.append(f)
    return kept


def main():
    df = pd.read_pickle(OUT / "episodes.pkl").reset_index(drop=True)
    df["goal_cluster"], k, sil = goal_clusters(df["goal"])
    print(f"Grupos de objetivo: k={k}, silueta={sil:.2f}")
    X = features(df, k)
    y = (df["outcome"] == "failed").astype(int)
    base = y.mean()

    # Primero se separan los fallos por lo que muestran (paso que falla y mensaje de error); los silenciosos van
    # juntos. Así dos causas distintas no se mezclan en una regla solo porque terminen igual de corta la conversación.
    failed_all = (df["outcome"] == "failed").values
    cause = pd.Series(np.where(failed_all, df.apply(
        lambda r: f"{r.decisive_step} | {r.decisive_error}" if r.has_error else "(sin error)", axis=1), ""), index=df.index)
    sizes = cause[cause != ""].value_counts()
    groups = [c for c, n in sizes.items() if n >= MIN_SUPPORT]
    print("Causas con soporte suficiente:", {g: int(sizes[g]) for g in groups})

    findings = []
    for g in groups:
        y = (cause == g).astype(int)
        train = ~(failed_all & (cause != g).values)  # los fallos de otras causas no cuentan como «no fallo»
        for _ in range(MAX_RULES):
            found = best_rule(X, y, train)
            if not found:
                break
            (p, r, lift), n_c = found
            if p * n_c > ALPHA:  # Bonferroni dentro de la ronda
                break
            path = generalize(X, y, r["path"])
            m = mask_for(X, path)
            members = df[m]
            fail_members = members[cause[m] == g]
            if len(fail_members) < MIN_SUPPORT:  # pocos fallos reales: una coincidencia, no un patrón
                break
            no_pv = [c_ for c_ in path if c_[0] != "prompt.version=2"]
            pop = df[mask_for(X, no_pv)]
            rate = {v: float((cause[pop.index][pop.prompt_version == v] == g).mean()) for v in ("1", "2")}
            findings.append({
                "path": path,
                "cause": g,
                "fail_ids": fail_members["trace_id"].tolist(),
                "rule": describe(path),
                "support": int(m.sum()),
                "failures": int(len(fail_members)),
                "failure_rate": round(float(y[m].mean()), 3),
                "lift": round(lift, 2),
                "p_value": p,
                "members": members["trace_id"].tolist(),
                "decisive_step": fail_members["decisive_step"].replace("", "(sin error)").value_counts().head(2).to_dict(),
                "decisive_error": fail_members["decisive_error"].replace("", "(sin error)").value_counts().head(2).to_dict(),
                "decisive_args": fail_members["decisive_args"].replace("", "(sin error)").value_counts().head(2).to_dict(),
                "tool_sequences": fail_members["tools"].value_counts().head(2).to_dict(),
                "failure_rate_by_prompt_version": {v: round(x, 3) for v, x in rate.items()},
                "occurrence_per_100_traces_by_prompt_version": {
                    v: round(100 * float((members.prompt_version == v).sum()) / max(int((df.prompt_version == v).sum()), 1), 2)
                    for v in ("1", "2")},
                "examples": fail_members["trace_id"].head(3).tolist(),
            })
            train &= ~(m & (y.values == 1))  # se retiran los fallos ya explicados

    findings = merge_overlapping(findings)
    findings = merge_duplicates(df, findings)
    for f in findings:
        f.pop("path", None)
        f.pop("fail_ids", None)

    covered = np.zeros(len(df), dtype=bool)
    for f in findings:
        covered |= df["trace_id"].isin(f["members"]).values
    resid = df[(df.outcome == "failed") & ~covered]
    unexplained = {
        "failures": int(len(resid)),
        "top_errors": resid["decisive_error"].replace("", "(sin error)").value_counts().head(3).to_dict(),
    }
    result = {"goal_clusters": k, "base_failure_rate": round(float(base), 3), "findings": findings, "unexplained": unexplained}
    (OUT / "findings.json").write_text(json.dumps(result, indent=1, default=str))
    df.to_pickle(OUT / "episodes_clustered.pkl")

    for f in findings:
        print(f"\n- {f['rule']}\n  soporte={f['support']}  fallos={f['failures']}  tasa={f['failure_rate']}  lift={f['lift']}  p={f['p_value']:.1e}")
        print(f"  paso={f['decisive_step']}  error={f['decisive_error']}")
        print(f"  tasa de fallo por versión de prompt={f['failure_rate_by_prompt_version']}")
    print("\nSin explicar:", unexplained)


if __name__ == "__main__":
    main()
