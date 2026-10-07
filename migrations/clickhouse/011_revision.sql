-- Versión del código en cada span (ADR-065). El SDK manda el commit como atributo de recurso OTel
-- `vcs.repository.ref.revision`; como columna real se puede filtrar y agrupar sin leer el mapa entero de cada span.
-- Es MATERIALIZED, igual que ConversationId (002): se calcula al insertar, así que el exporter del Collector no cambia.
-- Las trazas sin commit quedan con '' (versión desconocida).
ALTER TABLE memtrace.otel_traces
    ADD COLUMN IF NOT EXISTS Revision LowCardinality(String) MATERIALIZED ResourceAttributes['vcs.repository.ref.revision'] CODEC(ZSTD(1)),
    ADD INDEX IF NOT EXISTS idx_revision Revision TYPE bloom_filter(0.01) GRANULARITY 1;

-- Los datos ya guardados no tienen la columna física: se reescriben en segundo plano
ALTER TABLE memtrace.otel_traces MATERIALIZE COLUMN Revision;
ALTER TABLE memtrace.otel_traces MATERIALIZE INDEX idx_revision;
