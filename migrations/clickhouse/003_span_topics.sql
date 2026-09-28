-- Temáticas extraídas de las respuestas del agente (ADR-022).
-- Tabla separada de `otel_traces`: se rellena de forma asíncrona por el worker
-- `analytics/topic_extraction`, no por el exporter del Collector (ADR-003).
CREATE TABLE IF NOT EXISTS memtrace.span_topics
(
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    Topic LowCardinality(String) CODEC(ZSTD(1)),
    Confidence Float32 CODEC(ZSTD(1)),
    ModelVersion LowCardinality(String) CODEC(ZSTD(1)),
    ExtractedAt DateTime64(3) CODEC(Delta, ZSTD(1)),
    INDEX idx_topic Topic TYPE set(100) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(ExtractedAt)
ORDER BY (TraceId, SpanId)
TTL toDateTime(ExtractedAt) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
