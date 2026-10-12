-- Versión del prompt en cada span (ADR-068). El SDK marca el span que usa un prompt del registro con los atributos
-- `memtrace.prompt.name` y `memtrace.prompt.version`; como columnas reales se puede filtrar y agrupar (evidencia por
-- versión) sin leer el mapa entero de cada span.
-- Son MATERIALIZED, igual que Revision (011): se calculan al insertar, así que el exporter del Collector no cambia.
-- Los spans que no usan un prompt del registro quedan con '' y 0.
ALTER TABLE memtrace.otel_traces
    ADD COLUMN IF NOT EXISTS PromptName LowCardinality(String) MATERIALIZED SpanAttributes['memtrace.prompt.name'] CODEC(ZSTD(1)),
    ADD COLUMN IF NOT EXISTS PromptVersion UInt32 MATERIALIZED toUInt32OrZero(SpanAttributes['memtrace.prompt.version']) CODEC(ZSTD(1)),
    ADD INDEX IF NOT EXISTS idx_prompt_name PromptName TYPE bloom_filter(0.01) GRANULARITY 1;

-- Los datos ya guardados no tienen las columnas físicas: se reescriben en segundo plano
ALTER TABLE memtrace.otel_traces MATERIALIZE COLUMN PromptName;
ALTER TABLE memtrace.otel_traces MATERIALIZE COLUMN PromptVersion;
ALTER TABLE memtrace.otel_traces MATERIALIZE INDEX idx_prompt_name;
