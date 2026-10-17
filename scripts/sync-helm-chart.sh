#!/bin/sh
# Copia dentro del chart de Helm los ficheros que Kustomize lee de la raíz (Helm solo puede leer dentro del chart). ADR-096.
# Ejecútalo tras añadir o cambiar una migración, k8s/config/* o k8s/monitoring/config/*. El CI (scripts/check-helm-parity.py) falla si se olvida.
set -eu
cd "$(dirname "$0")/.."
chart=deploy/helm/memtrace
for d in clickhouse postgres; do
  mkdir -p "$chart/migrations/$d"
  rsync -a --delete --include='*.sql' --exclude='*' "migrations/$d/" "$chart/migrations/$d/"
done
mkdir -p "$chart/files"
rsync -a --delete --exclude monitoring/ k8s/config/ "$chart/files/"
mkdir -p "$chart/files/monitoring"
rsync -a --delete k8s/monitoring/config/ "$chart/files/monitoring/"
echo "Chart sincronizado con migrations/, k8s/config/ y k8s/monitoring/config/"
