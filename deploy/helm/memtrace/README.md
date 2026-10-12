# Chart de Helm de MemTrace

Instalación de producción de MemTrace (ADR-096). La guía para quien lo opera está en [docs-site/platform/operations.md](../../../docs-site/platform/operations.md); los valores, comentados, en [values.yaml](values.yaml).

```bash
helm install memtrace deploy/helm/memtrace -n memtrace --create-namespace -f mis-valores.yaml
```

## Para quien mantiene el chart

- `k8s/` + `kustomization.yaml` siguen siendo la vía de desarrollo (`make up`). Si cambias un manifiesto de `k8s/`, cambia también su plantilla en `templates/`: `scripts/check-helm-parity.py` (CI: `helm-chart.yml`) renderiza ambos y falla si difieren.
- Las migraciones (`migrations/`) y `files/` son copias de `migrations/*/` y `k8s/config/`: Helm solo lee dentro del chart. Tras añadir una migración, ejecuta `scripts/sync-helm-chart.sh`.
- Las plantillas son los manifiestos de `k8s/` con valores (imágenes, discos, recursos, red) y bloques condicionales (bases externas, copias, ingress). Los comentarios de los manifiestos se conservan.
- **Fuera del chart a propósito**: el Job `backfill-experiment-id` (solo sirve para datos anteriores a la migración 013) y el `Namespace` (`--create-namespace`).
- **Migraciones**: cada revisión lanza un Job nuevo (`clickhouse-migrate-<revisión>`, `postgres-migrate-<revisión>`) que caduca a la hora. No son hooks: con un hook, `helm install --wait` esperaría a unos pods (Collector) que necesitan esas migraciones.
- **No uses `--wait`**: el PVC `topic-model` queda `Pending` hasta que corre el CronJob de temas (StorageClass con `WaitForFirstConsumer`) y Helm espera a que todos los PVC estén enlazados. Comprueba el arranque con `kubectl rollout status`.
