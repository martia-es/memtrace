# Diseño Técnico - Fase 1: Plataforma de Trazabilidad (K8s, Instrumentación & Ingestión)

Este documento complementa a [`roadmap.md`](roadmap.md) detallando las decisiones técnicas de las piezas 1 (instrumentación), 2 (ingestión) y 3 (almacén) de la Fase 1. Las piezas 4 (API) y 5 (dashboard) se diseñarán en documentos posteriores.

Decisiones relacionadas:

- [ADR-001](adrs/adr-001-otel-collector-clickhouse.md): OTel Collector + ClickHouse.
- [ADR-002](adrs/adr-002-local-kubernetes-k3d.md): Kubernetes local con k3d (sustituye a Docker Compose).
- [ADR-003](adrs/adr-003-clickhouse-schema-and-migrations.md): esquema propio y migraciones versionadas.
- [ADR-004](adrs/adr-004-genai-semconv-and-content-capture.md): atributos GenAI y captura de contenido.
- [ADR-005](adrs/adr-005-persistent-storage-and-queue.md): persistencia de ClickHouse y cola persistente del Collector.
- [ADR-006](adrs/adr-006-kind-and-podman-support.md): Soporte para Kind y Podman en el entorno local de Kubernetes.

---

## 0. Servicios en Kubernetes Local

### 0.1 Arquitectura

Todos los componentes residen en el namespace `memtrace`.

```
        [ Agente Python / App ]  (host o pod)
                   │  OTLP gRPC 4317 / HTTP 4318
                   ▼
┌────────────────────────────────────────────────────────────────┐
│ Namespace K8s: memtrace                                        │
│                                                                │
│  ┌────────────────────────┐        ┌────────────────────────┐  │
│  │ OTel Collector         │        │ ClickHouse             │  │
│  │ Deployment (Recreate)  │───────►│ StatefulSet            │  │
│  │ PVC: cola persistente  │ native │ PVC: datos             │  │
│  └────────────────────────┘  9000  └───────────▲────────────┘  │
│                                                 │ migraciones   │
│                                      ┌──────────┴───────────┐   │
│                                      │ Job clickhouse-migrate│   │
│                                      └──────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

Todos los Services son `ClusterIP`. ClickHouse **no se expone fuera del clúster**: en producción solo lo consulta la API (pieza 4), y en local se accede con `kubectl exec`. El único acceso desde el host es el Collector vía `port-forward`.

### 0.2 Creación del clúster

```bash
k3d cluster create memtrace-cluster
kubectl apply -k .
```

El despliegue se define con **kustomize** desde un `kustomization.yaml` en la raíz del repo (`kubectl apply -k .`). Esto genera el ConfigMap de migraciones a partir de los `.sql`, sin pasos manuales:

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: memtrace
resources:
  - k8s/00-namespace.yaml
  - k8s/10-clickhouse-secret.yaml
  - k8s/20-clickhouse.yaml
  - k8s/30-clickhouse-migrations.yaml
  - k8s/40-otel-collector.yaml
configMapGenerator:
  - name: clickhouse-migrations
    files:
      - migrations/clickhouse/001_init_traces.sql
generatorOptions:
  disableNameSuffixHash: true   # el Job referencia el nombre fijo del ConfigMap
```

Cada migración nueva se añade a la lista `files` del generador.

### 0.3 Manifiestos

#### `k8s/00-namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: memtrace
```

#### `k8s/10-clickhouse-secret.yaml`

Credencial de desarrollo local. **No reutilizar** en entornos compartidos; allí se gestiona con un secret manager.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: clickhouse-credentials
  namespace: memtrace
type: Opaque
stringData:
  password: "memtrace-dev-only"
```

#### `k8s/20-clickhouse.yaml`

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: clickhouse
  namespace: memtrace
spec:
  serviceName: clickhouse
  replicas: 1
  selector:
    matchLabels:
      app: clickhouse
  template:
    metadata:
      labels:
        app: clickhouse
    spec:
      containers:
      - name: clickhouse
        image: clickhouse/clickhouse-server:23.8-alpine
        ports:
        - containerPort: 8123
          name: http
        - containerPort: 9000
          name: native
        env:
        - name: CLICKHOUSE_USER
          value: "default"
        - name: CLICKHOUSE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: clickhouse-credentials
              key: password
        readinessProbe:
          httpGet:
            path: /ping
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /ping
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2"
        volumeMounts:
        - name: data
          mountPath: /var/lib/clickhouse
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: clickhouse
  namespace: memtrace
spec:
  type: ClusterIP
  ports:
  - port: 8123
    targetPort: 8123
    name: http
  - port: 9000
    targetPort: 9000
    name: native
  selector:
    app: clickhouse
```

La base de datos y las tablas **no** las crea el contenedor ni el Collector: las crea el Job de migraciones.

#### `k8s/30-clickhouse-migrations.yaml`

Las migraciones viven en el repo como ficheros SQL numerados (`migrations/clickhouse/NNN_descripcion.sql`) y se montan vía ConfigMap (`kubectl create configmap ... --from-file` o kustomize). El Job aplica las que falten y registra cada versión en `memtrace.schema_migrations`, por lo que es idempotente y se puede relanzar.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: clickhouse-migrate
  namespace: memtrace
spec:
  backoffLimit: 6
  template:
    spec:
      restartPolicy: OnFailure
      containers:
      - name: migrate
        image: clickhouse/clickhouse-server:23.8-alpine
        env:
        - name: CLICKHOUSE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: clickhouse-credentials
              key: password
        command: ["/bin/sh", "-c"]
        args:
        - |
          set -eu
          CH="clickhouse-client --host clickhouse --user default --password $CLICKHOUSE_PASSWORD"
          until $CH --query "SELECT 1" >/dev/null 2>&1; do echo "waiting for clickhouse"; sleep 2; done
          $CH --query "CREATE DATABASE IF NOT EXISTS memtrace"
          $CH --query "CREATE TABLE IF NOT EXISTS memtrace.schema_migrations (version String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY version"
          for f in $(ls /migrations/*.sql | sort); do
            v=$(basename "$f")
            done_count=$($CH --query "SELECT count() FROM memtrace.schema_migrations WHERE version = '$v'")
            if [ "$done_count" = "0" ]; then
              echo "applying $v"
              $CH --multiquery < "$f"
              $CH --query "INSERT INTO memtrace.schema_migrations (version) VALUES ('$v')"
            else
              echo "skipping $v (already applied)"
            fi
          done
        volumeMounts:
        - name: migrations
          mountPath: /migrations
      volumes:
      - name: migrations
        configMap:
          name: clickhouse-migrations
```

El ConfigMap `clickhouse-migrations` lo genera kustomize (ver §0.2). Los Jobs de K8s son inmutables, así que para relanzar migraciones hay que borrar el Job antes de aplicar:

```bash
kubectl delete job clickhouse-migrate -n memtrace --ignore-not-found && kubectl apply -k .
```

#### `k8s/40-otel-collector.yaml`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: memtrace
data:
  otel-collector-config.yaml: |
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      file_storage/queue:
        directory: /var/lib/otelcol/queue
        timeout: 10s

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      # Evita que el collector exceda el límite de memoria del contenedor
      memory_limiter:
        check_interval: 1s
        limit_percentage: 80
        spike_limit_percentage: 20
      # Agrupa en lotes para maximizar la escritura columnar en ClickHouse
      batch:
        send_batch_size: 2000
        timeout: 1s
        send_batch_max_size: 5000

    exporters:
      clickhouse:
        endpoint: tcp://clickhouse.memtrace.svc.cluster.local:9000
        database: memtrace
        username: default
        password: ${env:CLICKHOUSE_PASSWORD}
        traces_table_name: otel_traces
        timeout: 5s
        retry_on_failure:
          enabled: true
          initial_interval: 5s
          max_interval: 30s
          max_elapsed_time: 3600s     # una caída de ClickHouse de hasta 1h no pierde datos
        sending_queue:
          enabled: true
          num_consumers: 4
          queue_size: 5000            # lotes, no spans
          storage: file_storage/queue # cola persistente en disco (ADR-005)

    service:
      extensions: [health_check, file_storage/queue]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [clickhouse]
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: otel-collector-queue
  namespace: memtrace
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
  namespace: memtrace
spec:
  replicas: 1
  strategy:
    type: Recreate            # el PVC es RWO: no pueden coexistir dos pods
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      securityContext:
        fsGroup: 10001        # usuario del contenedor contrib
      initContainers:
      # El provisioner local-path de k3d no siempre respeta fsGroup: se fijan permisos explícitamente
      - name: fix-queue-permissions
        image: busybox:1.36
        command: ["sh", "-c", "chown -R 10001:10001 /var/lib/otelcol/queue"]
        securityContext:
          runAsUser: 0
        volumeMounts:
        - name: queue
          mountPath: /var/lib/otelcol/queue
      containers:
      - name: otel-collector
        image: otel/opentelemetry-collector-contrib:0.96.0
        args: ["--config=/etc/otelcol-contrib/otel-collector-config.yaml"]
        env:
        - name: CLICKHOUSE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: clickhouse-credentials
              key: password
        ports:
        - containerPort: 4317
          name: otlp-grpc
        - containerPort: 4318
          name: otlp-http
        - containerPort: 13133
          name: health
        readinessProbe:
          httpGet:
            path: /
            port: health
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /
            port: health
          initialDelaySeconds: 15
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"     # base de memory_limiter (limit_percentage)
            cpu: "1"
        volumeMounts:
        - name: config-volume
          mountPath: /etc/otelcol-contrib
        - name: queue
          mountPath: /var/lib/otelcol/queue
      volumes:
      - name: config-volume
        configMap:
          name: otel-collector-config
      - name: queue
        persistentVolumeClaim:
          claimName: otel-collector-queue
---
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: memtrace
spec:
  type: ClusterIP
  ports:
  - port: 4317
    targetPort: 4317
    name: otlp-grpc
  - port: 4318
    targetPort: 4318
    name: otlp-http
  selector:
    app: otel-collector
```

Si ClickHouse aún no está listo o las migraciones no se han aplicado, el exporter falla y reintenta; los lotes quedan en la cola persistente y se entregan cuando la tabla existe (dentro de `max_elapsed_time`).

### 0.4 Conectividad

- **Dentro del clúster**: `otel-collector.memtrace.svc.cluster.local:4317` (gRPC) o `:4318` (HTTP).
- **Desde el host** (procesos Python locales):
  ```bash
  kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n memtrace
  ```

---

## 1. Librería de Instrumentación Python (`memtrace`)

`memtrace` es un wrapper ergonómico sobre el **OpenTelemetry SDK**.

### 1.1 Principios

1. **Aislamiento total (zero leakage)**: solo depende del OTel SDK y exporta por **OTLP**. No conoce ClickHouse.
2. **Fail-safe**: ningún fallo de MemTrace (Collector caído, error al crear spans, mala configuración) puede interrumpir el agente del usuario. Los errores de instrumentación se registran en el logger `memtrace` y se ignoran; las excepciones del código del usuario se propagan intactas.
3. **No bloqueante**: `BatchSpanProcessor` exporta en un hilo de fondo. Si el Collector no responde, la cola interna se llena y los spans se descartan; el agente no espera (timeout de exportación de 5 s en el hilo de fondo).
4. **Sin efectos globales**: usa su **propio** `TracerProvider` y no llama a `trace.set_tracer_provider`. Así no interfiere con la instrumentación OTel que la aplicación anfitriona ya tenga.
5. **Semántica GenAI**: atributos `gen_ai.*` según ADR-004.

### 1.2 Variables de entorno

| Variable | Defecto | Descripción |
|---|---|---|
| `MEMTRACE_ENABLED` | `true` | `false`/`0` desactiva la trazabilidad (todo pasa a no-op) |
| `MEMTRACE_OTLP_ENDPOINT` | `http://localhost:4317` | Endpoint OTLP/gRPC del Collector |
| `MEMTRACE_SERVICE_NAME` | `default-agent` | Nombre del agente/servicio |
| `MEMTRACE_CAPTURE_CONTENT` | `false` | Si `true`, se guardan prompts y completions (ADR-004) |

### 1.3 Código

#### A. `memtrace/tracer.py`

```python
import logging
import os
import threading
from typing import Optional

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger("memtrace")

_TRUE = ("1", "true", "yes", "on")
_lock = threading.Lock()
_provider: Optional[TracerProvider] = None
_NOOP_TRACER = trace.NoOpTracer()


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in _TRUE


def is_enabled() -> bool:
    return _env_bool("MEMTRACE_ENABLED", True)


def capture_content() -> bool:
    return _env_bool("MEMTRACE_CAPTURE_CONTENT", False)


def init_tracer(
    service_name: Optional[str] = None,
    endpoint: Optional[str] = None,
    insecure: Optional[bool] = None,
) -> None:
    """Inicializa MemTrace. Idempotente y nunca lanza excepciones."""
    global _provider
    with _lock:
        if _provider is not None:
            return
        if not is_enabled():
            logger.info("[MemTrace] Desactivado (MEMTRACE_ENABLED=false).")
            return
        try:
            service_name = service_name or os.getenv("MEMTRACE_SERVICE_NAME", "default-agent")
            endpoint = endpoint or os.getenv("MEMTRACE_OTLP_ENDPOINT", "http://localhost:4317")
            if insecure is None:
                insecure = not endpoint.startswith("https://")

            provider = TracerProvider(resource=Resource.create({SERVICE_NAME: service_name}))
            # La creación del exporter no abre conexión: los fallos de red ocurren
            # en el hilo de fondo del BatchSpanProcessor y solo se registran en logs.
            exporter = OTLPSpanExporter(endpoint=endpoint, insecure=insecure, timeout=5)
            provider.add_span_processor(BatchSpanProcessor(exporter))
            _provider = provider
        except Exception as exc:  # fail-safe: se queda en modo no-op
            logger.warning("[MemTrace] Inicialización fallida (%s). Modo no-op.", exc)


def get_tracer() -> trace.Tracer:
    """Tracer propio de MemTrace, o no-op si no está inicializado/activado."""
    return _provider.get_tracer("memtrace") if _provider else _NOOP_TRACER


def shutdown() -> None:
    """Fuerza el vaciado de spans pendientes (útil en scripts cortos)."""
    if _provider is not None:
        try:
            _provider.shutdown()
        except Exception as exc:
            logger.warning("[MemTrace] Error en shutdown: %s", exc)
```

#### B. `memtrace/decorators.py`

```python
import functools
import inspect
import json
import logging
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from .tracer import capture_content, get_tracer

logger = logging.getLogger("memtrace")


@contextmanager
def _step_span(span_name: str, step_type: str):
    """Abre un span sin que un fallo de instrumentación afecte al código del usuario."""
    try:
        cm = get_tracer().start_as_current_span(
            span_name, record_exception=False, set_status_on_exception=False
        )
        span = cm.__enter__()
        span.set_attribute("memtrace.step_type", step_type)
    except Exception as exc:
        logger.warning("[MemTrace] No se pudo abrir el span %s: %s", span_name, exc)
        yield
        return

    try:
        yield
    except BaseException as exc:
        try:
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            span.record_exception(exc)
        except Exception:
            pass
        _safe_exit(cm, type(exc), exc, exc.__traceback__)
        raise
    else:
        try:
            span.set_status(Status(StatusCode.OK))
        except Exception:
            pass
        _safe_exit(cm, None, None, None)


def _safe_exit(cm, exc_type, exc, tb) -> None:
    try:
        cm.__exit__(exc_type, exc, tb)
    except Exception as e:
        logger.warning("[MemTrace] Error cerrando span: %s", e)


def trace_step(name: Optional[str] = None, step_type: str = "chain"):
    """Instrumenta una función o método (síncrono o async) de un agente."""

    def decorator(func):
        span_name = name or func.__name__

        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with _step_span(span_name, step_type):
                    return await func(*args, **kwargs)
            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with _step_span(span_name, step_type):
                return func(*args, **kwargs)
        return wrapper

    return decorator


def trace_llm_call(
    provider: str,
    model: str,
    operation: str = "chat",
    input_messages: Optional[List[Dict[str, Any]]] = None,
    output_messages: Optional[List[Dict[str, Any]]] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> None:
    """Registra en el span actual los atributos GenAI (ADR-004). Nunca lanza."""
    try:
        span = trace.get_current_span()
        if not span.is_recording():
            return
        span.set_attribute("gen_ai.operation.name", operation)
        span.set_attribute("gen_ai.provider.name", provider)
        span.set_attribute("gen_ai.request.model", model)
        if input_tokens:
            span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
        if output_tokens:
            span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
        if capture_content():
            if input_messages is not None:
                span.set_attribute("gen_ai.input.messages", json.dumps(input_messages, default=str))
            if output_messages is not None:
                span.set_attribute("gen_ai.output.messages", json.dumps(output_messages, default=str))
    except Exception as exc:
        logger.warning("[MemTrace] trace_llm_call falló: %s", exc)
```

#### C. `memtrace/__init__.py`

```python
from .decorators import trace_llm_call, trace_step
from .tracer import init_tracer, shutdown

__all__ = ["init_tracer", "shutdown", "trace_step", "trace_llm_call"]
```

### 1.4 Ejemplo de uso

```python
from memtrace import init_tracer, shutdown, trace_step, trace_llm_call

init_tracer(service_name="research-agent")  # MEMTRACE_CAPTURE_CONTENT=true para guardar prompts

@trace_step(name="Analizar_Consulta", step_type="agent_step")
async def process_user_query(query: str):
    messages = [{"role": "user", "content": f"Procesa: {query}"}]
    answer = "Resultado del análisis"

    trace_llm_call(
        provider="openai",
        model="gpt-4o",
        input_messages=messages,
        output_messages=[{"role": "assistant", "content": answer}],
        input_tokens=150,
        output_tokens=45,
    )
    return answer

# En scripts cortos: shutdown() antes de salir para vaciar la cola
```

---

## 2. Almacenamiento en ClickHouse

El esquema es **propiedad de las migraciones** (ADR-003), no del Collector. Las columnas de `otel_traces` replican el esquema que espera el exporter `clickhouse` de `otelcol-contrib` (versión fijada en `0.96.0`); al actualizar el Collector hay que revisar que siga siendo compatible.

### 2.1 Migración `migrations/clickhouse/001_init_traces.sql`

```sql
CREATE TABLE IF NOT EXISTS memtrace.otel_traces
(
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId String CODEC(ZSTD(1)),
    TraceState String CODEC(ZSTD(1)),
    SpanName LowCardinality(String) CODEC(ZSTD(1)),
    SpanKind LowCardinality(String) CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration UInt64 CODEC(ZSTD(1)),
    StatusCode LowCardinality(String) CODEC(ZSTD(1)),
    StatusMessage String CODEC(ZSTD(1)),
    `Events.Timestamp` Array(DateTime64(9)) CODEC(ZSTD(1)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `Links.TraceId` Array(String) CODEC(ZSTD(1)),
    `Links.SpanId` Array(String) CODEC(ZSTD(1)),
    `Links.TraceState` Array(String) CODEC(ZSTD(1)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Tabla auxiliar: traceId -> rango temporal, para localizar una traza sin escanear otel_traces
CREATE TABLE IF NOT EXISTS memtrace.otel_traces_trace_id_ts
(
    TraceId String CODEC(ZSTD(1)),
    Start DateTime64(9) CODEC(Delta, ZSTD(1)),
    End DateTime64(9) CODEC(Delta, ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Start)
ORDER BY (TraceId, toUnixTimestamp(Start))
TTL toDateTime(Start) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS memtrace.otel_traces_trace_id_ts_mv
TO memtrace.otel_traces_trace_id_ts
AS SELECT
    TraceId,
    min(Timestamp) AS Start,
    max(Timestamp) AS End
FROM memtrace.otel_traces
WHERE TraceId != ''
GROUP BY TraceId;
```

### 2.2 Decisiones de diseño del esquema

1. **`ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))`**: optimiza agregaciones por agente y tipo de span en rangos de tiempo (P95, tasas de error).
2. **Búsqueda por `TraceId`**: la clave de ordenación no la favorece, por eso existe `otel_traces_trace_id_ts`. La API (pieza 4) obtiene primero `Start/End` de la traza y luego consulta `otel_traces` acotando por rango temporal (poda de particiones diarias). El bloom filter de `TraceId` solo actúa como ayuda adicional.
3. **Listado de trazas**: se obtiene filtrando spans raíz (`ParentSpanId = ''`) dentro de un rango temporal. Si el volumen lo exige, se añadirá una proyección o vista materializada mediante una nueva migración.
4. **Retención**: TTL de 30 días definido únicamente aquí. Partición diaria + `ttl_only_drop_parts = 1` permite purgar descartando particiones enteras, sin reescribir datos.
5. **Compresión**: `ZSTD(1)` en columnas de texto. El ratio real depende de los datos; se medirá con trazas reales antes de dimensionar el disco.

### 2.3 Añadir migraciones futuras

Crear `migrations/clickhouse/NNN_descripcion.sql` (numeración correlativa, nunca editar una ya aplicada), añadirla a `configMapGenerator` en `kustomization.yaml` y relanzar el Job (comando en §0.3).

---

## 3. Verificación del Flujo Completo

1. **Crear clúster**:
   ```bash
   k3d cluster create memtrace-cluster
   ```
2. **Desplegar todo** (namespace, ConfigMap de migraciones, ClickHouse, Job y Collector):
   ```bash
   kubectl apply -k .
   ```
3. **Esperar a que todo esté listo**:
   ```bash
   kubectl wait --for=condition=complete job/clickhouse-migrate -n memtrace --timeout=180s
   kubectl get pods,pvc -n memtrace
   ```
4. **Exponer el Collector y ejecutar un agente de prueba**:
   ```bash
   kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n memtrace &
   MEMTRACE_CAPTURE_CONTENT=true python test_agent.py
   ```
5. **Consultar trazas**:
   ```bash
   kubectl exec -it statefulset/clickhouse -n memtrace -- clickhouse-client --password memtrace-dev-only \
     --query "SELECT ServiceName, count() AS spans, uniqExact(TraceId) AS traces FROM memtrace.otel_traces GROUP BY ServiceName"
   ```
6. **Verificar persistencia**:
   ```bash
   kubectl delete pod clickhouse-0 -n memtrace   # los datos deben seguir ahí al reiniciar
   kubectl rollout restart deploy/otel-collector -n memtrace
   ```
7. **Verificar cola persistente**: escalar ClickHouse a 0 (`kubectl scale statefulset/clickhouse --replicas=0 -n memtrace`), enviar trazas, volver a 1 y comprobar que los spans llegan.
8. **Verificar compatibilidad exporter/esquema**: tras enviar la primera traza, `kubectl logs deploy/otel-collector -n memtrace` no debe mostrar errores de inserción (columnas desconocidas o ausentes). Si los hay, contrastar `001_init_traces.sql` con el esquema generado por las migraciones.
9. **Verificar permisos de la cola**: el Collector debe arrancar sin errores de `file_storage` y aparecer contenido en `/var/lib/otelcol/queue` (`kubectl exec deploy/otel-collector -n memtrace -- ls /var/lib/otelcol/queue`).

### Límites conocidos

- La cola persistente protege solo el tramo Collector → ClickHouse. Si el Collector está caído, el `BatchSpanProcessor` del SDK descarta spans al llenarse su cola en memoria (comportamiento intencionado: no bloquear al agente).
- El volumen de la cola es de 2Gi: en una caída larga con mucho tráfico puede llenarse y rechazar datos. No hay alertas en Fase 1.
