-- Catálogo de precios por modelo, sincronizado desde LiteLLM (ADR-025).
-- Tabla separada de `otel_traces`: se rellena por el worker `analytics/model_pricing`,
-- no por el exporter del Collector (ADR-003). Es catálogo de referencia, no traza: sin TTL.
CREATE TABLE IF NOT EXISTS memtrace.model_pricing
(
    ModelId LowCardinality(String) CODEC(ZSTD(1)),
    Provider LowCardinality(String) CODEC(ZSTD(1)),
    InputPricePerToken Float64 CODEC(ZSTD(1)),
    OutputPricePerToken Float64 CODEC(ZSTD(1)),
    Source LowCardinality(String) CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(UpdatedAt)
ORDER BY (ModelId)
SETTINGS index_granularity = 8192;
