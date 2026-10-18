"""Puntúa el pipeline contra ground_truth.json. Es el único script que lo lee."""
import json
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
truth = json.loads((HERE / "data" / "ground_truth.json").read_text())
eps = pd.read_pickle(HERE / "out" / "episodes.pkl")
eps["true_failed"] = eps["trace_id"].map(lambda t: truth[t]["failed"])
eps["modes"] = eps["trace_id"].map(lambda t: ",".join(sorted(set(truth[t]["modes"]))))


def outcome_report():
    print("== Resultado multi-señal frente a la verdad ==")
    ct = pd.crosstab(eps["true_failed"], eps["outcome"])
    print(ct.to_string())
    pred = eps["outcome"].isin(["failed"])
    tp = (pred & eps.true_failed).sum()
    print(f"precisión {tp / max(pred.sum(), 1):.3f}  recall {tp / eps.true_failed.sum():.3f}")
    pred2 = eps["outcome"].isin(["failed", "suspect"])
    tp2 = (pred2 & eps.true_failed).sum()
    print(f"(failed+suspect) precisión {tp2 / max(pred2.sum(), 1):.3f}  recall {tp2 / eps.true_failed.sum():.3f}")
    print("\nRecall por modo (trazas con ese modo marcadas failed):")
    for m in ["F1", "F2", "F3", "F4", "F5", "F6"]:
        sub = eps[eps.modes.str.contains(m)]
        print(f"  {m}: {len(sub):4d} trazas, failed {(sub.outcome == 'failed').mean():.2f}, failed+suspect {(sub.outcome != 'ok').mean():.2f}")


def discovery_report():
    f = json.loads((HERE / "out" / "findings.json").read_text())
    findings = f["findings"]
    print("\n== Descubrimiento frente a los fallos sembrados ==")
    mode_ids = {m: {t for t, v in truth.items() if m in v["modes"]} for m in ["F1", "F2", "F3", "F4", "F5", "F6"]}
    for m, ids in mode_ids.items():
        best = None
        for i, fi in enumerate(findings):
            members = set(fi["members"])
            inter = len(ids & members)
            rec, pur = inter / len(ids), inter / max(len(members), 1)
            if best is None or rec * pur > best[0]:
                best = (rec * pur, i, rec, pur)
        _, i, rec, pur = best
        print(f"  {m}: mejor hallazgo #{i}: recall {rec:.2f}, pureza {pur:.2f}  -> {findings[i]['rule'][:70]}")
    print("\n  Trazas de ruido F6 dentro de cada hallazgo / soporte:")
    for i, fi in enumerate(findings):
        print(f"    #{i}: {len(mode_ids['F6'] & set(fi['members']))}/{fi['support']}")
    resid = f["unexplained"]
    print(f"  Fallos sin explicar: {resid['failures']}  {resid['top_errors']}")
    print("\n  Ocurrencia por 100 trazas y versión de prompt (F7: F1 debería caer con el prompt v2):")
    for i, fi in enumerate(findings):
        print(f"    #{i}: {fi['occurrence_per_100_traces_by_prompt_version']}  {fi['rule'][:50]}")


if __name__ == "__main__":
    outcome_report()
    discovery_report()
