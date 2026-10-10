-- Aislamiento por experimento (ADR-077). Hasta ahora todo el almacén se acotaba por ServiceName, que solo es único dentro
-- de una organización: dos clientes con el mismo `service.name` verían las trazas del otro. Cada fila lleva ahora el
-- identificador del experimento (UUID de Postgres) y las consultas lo exigen además del ServiceName.
--
-- otel_traces: el gateway de ingesta (ADR-078) fija el atributo de recurso `memtrace.experiment_id` y la columna lo copia al
-- insertar, así que el exporter del Collector no cambia. Es DEFAULT y no MATERIALIZED a propósito: una columna
-- MATERIALIZED no admite ALTER ... UPDATE, y las filas anteriores a esta migración hay que asignarlas con el backfill
-- (api/src/worker/backfill-experiment-id.ts). Hasta que se asignen valen '' y ninguna consulta las devuelve (falla cerrado).
ALTER TABLE memtrace.otel_traces
    ADD COLUMN IF NOT EXISTS ExperimentId LowCardinality(String) DEFAULT ResourceAttributes['memtrace.experiment_id'] CODEC(ZSTD(1)),
    ADD INDEX IF NOT EXISTS idx_experiment_id ExperimentId TYPE bloom_filter(0.01) GRANULARITY 1;

-- Tablas que escribe la API: el experimento lo pone el repositorio en cada INSERT, a partir de la API key o la sesión.
-- Entra en la clave de ordenación, que en un ReplacingMergeTree es también la identidad de deduplicación: sin él, dos
-- experimentos con el mismo ServiceName que usen el mismo id (un TraceId o un voto sobre una traza que el cliente puede
-- elegir) se pisarían entre sí al fusionar. ClickHouse solo permite ampliar la clave con columnas añadidas en el mismo ALTER
-- y sin expresión DEFAULT (las filas anteriores valen '', el valor por defecto del tipo).
-- Consecuencia: ExperimentId no se puede cambiar con UPDATE; el backfill de las filas anteriores copia y borra
-- (api/src/worker/backfill-experiment-id.ts).
ALTER TABLE memtrace.eval_items         ADD COLUMN ExperimentId LowCardinality(String) CODEC(ZSTD(1)), MODIFY ORDER BY (ServiceName, DatasetRunId, ItemIndex, ExperimentId);
ALTER TABLE memtrace.eval_scores        ADD COLUMN ExperimentId LowCardinality(String) CODEC(ZSTD(1)), MODIFY ORDER BY (ServiceName, DatasetRunId, ItemIndex, Name, ExperimentId);
ALTER TABLE memtrace.eval_run_summaries ADD COLUMN ExperimentId LowCardinality(String) CODEC(ZSTD(1)), MODIFY ORDER BY (ServiceName, DatasetRunId, Name, ExperimentId);
ALTER TABLE memtrace.annotations        ADD COLUMN ExperimentId LowCardinality(String) CODEC(ZSTD(1)), MODIFY ORDER BY (ServiceName, TargetType, TraceId, DatasetRunId, ItemIndex, SpanId, ConfigId, AnnotatorId, ExperimentId);
ALTER TABLE memtrace.user_feedback      ADD COLUMN ExperimentId LowCardinality(String) CODEC(ZSTD(1)), MODIFY ORDER BY (ServiceName, TraceId, SpanId, EndUserId, ExperimentId);
