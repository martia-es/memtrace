-- Usuario final como columna real (ADR-067, actualización). Overview › Breakdown agrupa por usuario para dar el coste de cada uno.
-- Es MATERIALIZED, como ConversationId (002): se calcula al insertar a partir del atributo estándar `enduser.id`, así que el
-- exporter del Collector (que inserta con lista explícita de columnas) no cambia.
ALTER TABLE memtrace.otel_traces
    ADD COLUMN IF NOT EXISTS UserId String MATERIALIZED SpanAttributes['enduser.id'] CODEC(ZSTD(1)),
    ADD INDEX IF NOT EXISTS idx_user_id UserId TYPE bloom_filter(0.01) GRANULARITY 1;

-- Los datos ya guardados no tienen la columna física (se calcula al leer): se reescriben en segundo plano
ALTER TABLE memtrace.otel_traces MATERIALIZE COLUMN UserId;
ALTER TABLE memtrace.otel_traces MATERIALIZE INDEX idx_user_id;
