#!/usr/bin/env python3
"""Comprueba que el chart de Helm (deploy/helm/memtrace) despliega lo mismo que Kustomize (kustomization.yaml). ADR-096.

Renderiza los dos con valores por defecto y compara, objeto a objeto, lo que el clúster recibiría. Ignora lo que el chart
cambia a propósito (el Job de migraciones por revisión, checksum de la configuración, Secrets, que el chart genera) y los sufijos
hash que Kustomize añade a los ConfigMap y Secret que genera. Además comprueba que las migraciones y la configuración
copiadas dentro del chart coinciden con las de la raíz del repositorio.

Uso: python3 scripts/check-helm-parity.py [--helm RUTA] [--kubectl RUTA]
Necesita `helm` y `kubectl` (o `kustomize`) y, para Kustomize, los ficheros k8s/secrets/*.env (vacíos sirven).
"""
import argparse, filecmp, glob, os, re, subprocess, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HASHED = re.compile(r"\b(identity-oauth-credentials|resend-credentials|clickhouse-config|prometheus-config|prometheus-rules|grafana-provisioning|grafana-dashboards)-[a-z0-9]{10}\b")
# El chart no incluye estos recursos a propósito (ver deploy/helm/memtrace/README.md)
NOT_IN_CHART = {("Namespace", "memtrace"), ("Job", "backfill-experiment-id")}
# Los Secret los crea el chart con valores propios: solo se comprueba que existen
SECRETS_ONLY_NAME = True


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def load(text):
    docs = {}
    for d in yaml.safe_load_all(HASHED.sub(lambda m: m.group(1), text)):
        if d:
            if d["kind"] == "Job":
                d["metadata"]["name"] = re.sub(r"^((?:clickhouse|postgres)-migrate|kafka-topics|dedupe-otel-traces)-\d+$", r"\1", d["metadata"]["name"])
            docs[(d["kind"], d["metadata"]["name"])] = d
    return docs


def normalise(d):
    d = yaml.safe_load(yaml.safe_dump(d))
    if d["kind"] == "Job" and d["metadata"]["name"].startswith(("clickhouse-migrate", "postgres-migrate", "kafka-topics", "dedupe-otel-traces")):
        d["spec"].pop("ttlSecondsAfterFinished", None)   # el chart lanza un Job nuevo por revisión y lo caduca solo
    d["metadata"].pop("namespace", None)
    ann = d["metadata"].get("annotations")
    if ann:
        for k in [k for k in ann if k.startswith("helm.sh/")]:
            ann.pop(k)
        if not ann:
            d["metadata"].pop("annotations")
    tmpl = d.get("spec", {}).get("template", {}).get("metadata", {})
    if tmpl.get("annotations"):
        tmpl["annotations"].pop("checksum/config", None)
        if not tmpl["annotations"]:
            tmpl.pop("annotations")
    return d


def compare(kust, helm, bad, not_in_chart):
    for k in sorted(kust.keys() - helm.keys() - not_in_chart):
        bad.append(f"{k[0]}/{k[1]}: está en Kustomize y falta en el chart")
    for k in sorted(helm.keys() - kust.keys()):
        if k[0] == "Secret" or k == ("Ingress", "memtrace"):
            continue
        bad.append(f"{k[0]}/{k[1]}: está en el chart y no en Kustomize")
    for k in sorted(kust.keys() & helm.keys()):
        if k[0] == "Secret":
            continue
        x, y = normalise(kust[k]), normalise(helm[k])
        if x != y:
            ax, ay = yaml.safe_dump(x, sort_keys=True).splitlines(), yaml.safe_dump(y, sort_keys=True).splitlines()
            import difflib
            diff = "\n".join(list(difflib.unified_diff(ax, ay, "kustomize", "helm", lineterm="", n=1))[:30])
            bad.append(f"{k[0]}/{k[1]} difiere:\n{diff}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--helm", default="helm")
    ap.add_argument("--kubectl", default="kubectl")
    a = ap.parse_args()
    bad = []

    for src, dst in (("migrations/clickhouse", "deploy/helm/memtrace/migrations/clickhouse"),
                     ("migrations/postgres", "deploy/helm/memtrace/migrations/postgres"),
                     ("k8s/config", "deploy/helm/memtrace/files"),
                     ("k8s/monitoring/config", "deploy/helm/memtrace/files/monitoring")):
        # solo ficheros: `files/` también contiene la carpeta `monitoring/`, que se compara en su propia pareja
        s = sorted(f for f in os.listdir(f"{ROOT}/{src}") if os.path.isfile(f"{ROOT}/{src}/{f}"))
        d = sorted(f for f in os.listdir(f"{ROOT}/{dst}") if os.path.isfile(f"{ROOT}/{dst}/{f}"))
        s = [f for f in s if not f.startswith(".")]
        if s != d:
            bad.append(f"{dst}: faltan o sobran ficheros respecto a {src} (ejecuta scripts/sync-helm-chart.sh): {set(s) ^ set(d)}")
            continue
        for f in s:
            if not filecmp.cmp(f"{ROOT}/{src}/{f}", f"{ROOT}/{dst}/{f}", shallow=False):
                bad.append(f"{dst}/{f} difiere de {src}/{f} (ejecuta scripts/sync-helm-chart.sh)")

    kust = load(run([a.kubectl, "kustomize", "."]))
    helm = load(run([a.helm, "template", "memtrace", "deploy/helm/memtrace", "--namespace", "memtrace"]))
    compare(kust, helm, bad, NOT_IN_CHART)

    # Monitoring opcional (ADR-098): `k8s/monitoring` frente a lo que el chart añade con `monitoring.enabled=true`
    mon_kust = load(run([a.kubectl, "kustomize", "k8s/monitoring"]))
    helm_on = load(run([a.helm, "template", "memtrace", "deploy/helm/memtrace", "--namespace", "memtrace", "--set", "monitoring.enabled=true"]))
    compare(mon_kust, {k: v for k, v in helm_on.items() if k not in helm}, bad, set())
    kust = {**kust, **mon_kust}
    helm = helm_on

    if bad:
        print("\n\n".join(bad))
        sys.exit(1)
    print(f"OK: el chart coincide con Kustomize ({len(kust)} objetos de Kustomize, {len(helm)} del chart)")


if __name__ == "__main__":
    main()
