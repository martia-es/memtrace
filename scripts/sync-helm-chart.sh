#!/bin/sh
# Copia dentro del chart de Helm los ficheros que Kustomize lee de la raíz (Helm solo puede leer dentro del chart). ADR-096.
# Ejecútalo tras añadir o cambiar una migración o k8s/config/*. El CI (scripts/check-helm-parity.py) falla si se olvida.
set -eu
cd "$(dirname "$0")/.."
chart=deploy/helm/memtrace
for d in clickhouse postgres; do
  mkdir -p "$chart/migrations/$d"
  rsync -a --delete --include='*.sql' --exclude='*' "migrations/$d/" "$chart/migrations/$d/"
done
mkdir -p "$chart/files"
rsync -a --delete k8s/config/ "$chart/files/"
echo "Chart sincronizado con migrations/ y k8s/config/"
