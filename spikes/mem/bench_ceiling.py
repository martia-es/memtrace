"""Techo del brazo 3 (diagnóstico + agrupación semántica): agrupa las razones HUMANAS de Who&When y mide cuánto se parecen
los clusters a la taxonomía. Si con un diagnóstico humano no agrupa bien, uno de LLM no lo hará mejor.

Uso: uv run python bench_ceiling.py
"""
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

df = pd.read_parquet("out/datasets/whowhen.parquet")
df = df[df.cause_behavior != "unclear"].reset_index(drop=True)
y = df.cause_behavior.values
X = SentenceTransformer("all-MiniLM-L6-v2").encode(df.cause_text.tolist(), normalize_embeddings=True)
print(f"{len(df)} razones, {len(set(y))} causas (sin `unclear`)")


def purity(labels):
    ok = [l for l in set(labels) if l != -1]
    return sum(pd.Series(y[labels == l]).value_counts().iloc[0] for l in ok) / max(1, (labels != -1).sum())


for name, labels in [
    (f"KMeans k={len(set(y))}", KMeans(len(set(y)), n_init=10, random_state=7).fit_predict(X)),
    ("HDBSCAN min=5", HDBSCAN(min_cluster_size=5).fit_predict(X)),
    ("HDBSCAN min=8", HDBSCAN(min_cluster_size=8).fit_predict(X)),
]:
    m = labels != -1
    print(f"{name:16s} clusters={len(set(labels)) - (-1 in labels)} ruido={(~m).mean():.0%} "
          f"pureza={purity(labels):.2f} ARI={adjusted_rand_score(y[m], labels[m]):.2f} NMI={normalized_mutual_info_score(y[m], labels[m]):.2f}")
base = pd.Series(y).value_counts(normalize=True).iloc[0]
print(f"referencia: acertar siempre la causa más común = {base:.2f}")
