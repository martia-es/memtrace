"""Ablations and baselines for the episode + rule-discovery pipeline (analytics/mem) on the synthetic spike data.

Usage (from the repo root, with the spike's virtualenv, which has pandas/scikit-learn/sentence-transformers):
    PYTHONPATH=analytics/mem:spikes/mem spikes/mem/.venv/bin/python docs/research/mem-paper/experiments.py \
        --work-dir /tmp/mem-paper-work --out-dir docs/research/mem-paper/results [--seeds 7 11 13 17 19] [--no-clusters]

Everything is deterministic given the seeds. Nothing here reads `ground_truth.json` except the scoring functions.
The pipeline under test is the PRODUCTION code (`mem.episode.score_outcome`, `mem.discovery.discover`), not the spike's.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier

import episodes as spike_episodes  # spikes/mem/episodes.py: builds episode rows from the synthetic spans
from mem import discovery
from mem.discovery import Config, build_features, cluster_goals, discover, sentence_transformers_embedder
from mem.episode import score_outcome

SPIKE = Path(__file__).resolve().parents[3] / "spikes" / "mem"
MODES = ["F1", "F2", "F3", "F4", "F5", "F6"]
MATCH_MIN = 0.5  # a finding "matches" a seeded mode when recall and purity are both >= this


# ---------------------------------------------------------------- data

def make_episodes(seed: int, work: Path) -> tuple[pd.DataFrame, dict]:
    d = work / f"seed{seed}"
    (d / "data").mkdir(parents=True, exist_ok=True)
    if not (d / "data" / "ground_truth.json").exists():
        subprocess.run([sys.executable, "-I", str(SPIKE / "gen_traces.py"), "--seed", str(seed), "--out", str(d / "data")], check=True, capture_output=True)
    spike_episodes.DATA, spike_episodes.OUT = d / "data", d / "out"
    eps = spike_episodes.build().reset_index(drop=True)
    truth = json.loads((d / "data" / "ground_truth.json").read_text())
    return eps, truth


# ---------------------------------------------------------------- scoring

def mode_sets(truth: dict) -> dict[str, set[str]]:
    return {m: {t for t, v in truth.items() if m in v["modes"]} for m in MODES}


def score_findings(member_lists: list[list[str]], sets: dict[str, set[str]]) -> dict:
    """Per seeded mode: best finding by recall*purity. A finding is *spurious* when no seeded failure mode (F1-F5)
    makes up at least half of its members (so noise-only or mixed findings count; a second rule for a real mode does not)."""
    per_mode = {}
    for m, ids in sets.items():
        best = (0.0, 0.0)
        for members in member_lists:
            inter = len(ids & set(members))
            rec, pur = inter / len(ids), inter / max(len(members), 1)
            if rec * pur > best[0] * best[1]:
                best = (rec, pur)
        per_mode[m] = {"recall": round(best[0], 3), "purity": round(best[1], 3)}
    real = [m for m in MODES if m != "F6"]
    spurious = sum(1 for members in member_lists if max(len(sets[m] & set(members)) for m in real) / max(len(members), 1) < MATCH_MIN)
    return {"per_mode": per_mode, "n_findings": len(member_lists), "n_spurious": spurious}


# ---------------------------------------------------------------- pipeline variants

def run_discover(eps: pd.DataFrame, labels, k: int, cfg: Config, *, no_entities=False, no_cause_split=False, no_generalize=False) -> list[list[str]]:
    df = eps.copy()
    if no_entities:
        df = df.drop(columns=["goal"])
    if no_cause_split:
        df["has_error"] = False  # every failure becomes the single cause "(sin error)"
    original = discovery._generalize
    if no_generalize:
        discovery._generalize = lambda X, y, path, cfg: path
    try:
        res = discover(df, cfg, labels, k)
    finally:
        discovery._generalize = original
    return [f.members for f in res.findings]


def baseline_error_summary(eps: pd.DataFrame) -> list[list[str]]:
    """What an error dashboard does: group failed traces by (failing step, error). Silent failures fall in one group."""
    failed = eps[eps.outcome == "failed"]
    key = failed.apply(lambda r: (r.decisive_step, r.decisive_error) if r.has_error else ("", ""), axis=1)
    return [g.trace_id.tolist() for _, g in failed.groupby(key)]


def baseline_plain_tree(eps: pd.DataFrame, labels, k: int, cfg: Config) -> list[list[str]]:
    """One depth-3 decision tree on the same features, no statistical test, no sequential coverage, no merging."""
    df = eps.copy()
    df["goal_cluster"] = labels.reset_index(drop=True) if labels is not None else 0
    X = build_features(df, k, cfg)
    y = (df.outcome == "failed").astype(int)
    tree = DecisionTreeClassifier(max_depth=cfg.tree_depth, min_samples_leaf=cfg.min_support, random_state=0).fit(X, y)
    leaves = tree.apply(X)
    out = []
    for leaf in np.unique(leaves):
        m = leaves == leaf
        if m.sum() >= cfg.min_support and y[m].mean() >= 0.5 and y[m].sum() >= cfg.min_support:
            out.append(df.trace_id[m].tolist())
    return out


# ---------------------------------------------------------------- outcome-signal ablation

SIGNAL_SETS = {
    "error only": dict(error=True, loop=False, evaluator=False, feedback=False),
    "error + loop": dict(error=True, loop=True, evaluator=False, feedback=False),
    "error + loop + evaluator": dict(error=True, loop=True, evaluator=True, feedback=False),
    "error + loop + feedback": dict(error=True, loop=True, evaluator=False, feedback=True),
    "all signals (production)": dict(error=True, loop=True, evaluator=True, feedback=True),
}


def outcome_ablation(eps: pd.DataFrame, truth: dict) -> dict:
    actual = eps.trace_id.map(lambda t: truth[t]["failed"]).values
    silent = eps.trace_id.map(lambda t: "F3" in truth[t]["modes"] or "F5" in truth[t]["modes"]).values
    out = {}
    for name, use in SIGNAL_SETS.items():
        pred = []
        for r in eps.itertuples():
            thumbs = {"down": -1, "up": 1}.get(r.thumbs, 0) if use["feedback"] else 0
            ev_failed = use["evaluator"] and r.eval_score == 0
            ev_ok = use["evaluator"] and r.eval_score == 1
            _, outcome, _ = score_outcome(has_error=bool(r.has_error) and use["error"], loop=bool(r.loop) and use["loop"], thumbs=thumbs, eval_failed=ev_failed, eval_ok=ev_ok)
            pred.append(outcome == "failed")
        pred = np.array(pred)
        tp = int((pred & actual).sum())
        p, rc = tp / max(pred.sum(), 1), tp / max(actual.sum(), 1)
        out[name] = {"precision": round(p, 3), "recall": round(rc, 3), "f1": round(2 * p * rc / max(p + rc, 1e-9), 3),
                     "recall_silent": round(float((pred & actual & silent).sum() / max((actual & silent).sum(), 1)), 3)}
    return out


# ---------------------------------------------------------------- main

def mean_std(values: list[float]) -> str:
    return f"{np.mean(values):.2f} ± {np.std(values):.2f}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[7, 11, 13, 17, 19])
    ap.add_argument("--no-clusters", action="store_true", help="skip the embedding model (clustered variants are then reported without clusters)")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    embedder = None if args.no_clusters else sentence_transformers_embedder()
    cfg = Config()

    variants = {
        "full pipeline": dict(cfg=cfg, clusters=True),
        "- goal clusters": dict(cfg=cfg, clusters=False),
        "- goal-entity feature": dict(cfg=cfg, clusters=True, no_entities=True),
        "- Fisher/Bonferroni (alpha=1e9)": dict(cfg=replace(cfg, alpha=1e9), clusters=True),
        "- rule generalisation": dict(cfg=cfg, clusters=True, no_generalize=True),
        "- sequential coverage (1 rule/cause)": dict(cfg=replace(cfg, max_rules=1), clusters=True),
        "- cause split (errors vs silent)": dict(cfg=cfg, clusters=True, no_cause_split=True),
    }
    rows: dict[str, list[dict]] = {}
    outcomes: dict[str, list[dict]] = {}
    for seed in args.seeds:
        eps, truth = make_episodes(seed, args.work_dir)
        sets = mode_sets(truth)
        labels, k = (None, 0) if embedder is None else cluster_goals(eps["goal"], embedder)[:2]
        print(f"seed {seed}: {len(eps)} episodes, {int((eps.outcome == 'failed').sum())} failed, k={k}", flush=True)
        for name, v in variants.items():
            use_clusters = v["clusters"] and labels is not None
            members = run_discover(eps, labels if use_clusters else None, k if use_clusters else 0, v["cfg"],
                                   no_entities=v.get("no_entities", False), no_cause_split=v.get("no_cause_split", False), no_generalize=v.get("no_generalize", False))
            rows.setdefault(name, []).append(score_findings(members, sets))
        rows.setdefault("baseline: error summary", []).append(score_findings(baseline_error_summary(eps), sets))
        rows.setdefault("baseline: single decision tree", []).append(score_findings(baseline_plain_tree(eps, labels, k, cfg), sets))
        for name, res in outcome_ablation(eps, truth).items():
            outcomes.setdefault(name, []).append(res)

    (args.out_dir / "results.json").write_text(json.dumps({"seeds": args.seeds, "discovery": rows, "outcome": outcomes}, indent=1))

    md = [f"Seeds: {args.seeds}. Mean ± std over seeds. Recall / purity of the best finding per seeded mode; F6 is noise (lower is better).\n",
          "| Variant | " + " | ".join(f"{m} rec" for m in MODES[:5]) + " | F5 pur | F6 rec | findings | spurious |", "|---|" + "---|" * 9]
    for name, rs in rows.items():
        cells = [mean_std([r["per_mode"][m]["recall"] for r in rs]) for m in MODES[:5]]
        cells += [mean_std([r["per_mode"]["F5"]["purity"] for r in rs]), mean_std([r["per_mode"]["F6"]["recall"] for r in rs]),
                  mean_std([r["n_findings"] for r in rs]), mean_std([r["n_spurious"] for r in rs])]
        md.append(f"| {name} | " + " | ".join(cells) + " |")
    md += ["", "Purity of the best finding, per mode (mean over seeds):", "", "| Variant | " + " | ".join(f"{m} pur" for m in MODES[:5]) + " |", "|---|" + "---|" * 5]
    for name, rs in rows.items():
        md.append(f"| {name} | " + " | ".join(mean_std([r["per_mode"][m]["purity"] for r in rs]) for m in MODES[:5]) + " |")
    md += ["", "Outcome estimation vs. seeded ground truth (trace is `failed`):", "", "| Signals | precision | recall | F1 | recall on silent failures (F3, F5) |", "|---|---|---|---|---|"]
    for name, rs in outcomes.items():
        md.append(f"| {name} | " + " | ".join(mean_std([r[k] for r in rs]) for k in ("precision", "recall", "f1", "recall_silent")) + " |")
    (args.out_dir / "results.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
