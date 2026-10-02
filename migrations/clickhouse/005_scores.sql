-- Scores de evaluación offline (ADR-028, roadmap Fase 1.75). Mismo perfil de volumen/escritura
-- que las trazas (un score por evaluador por item), por eso viven aquí y no en PostgreSQL —
-- criterio ya usado en ADR-013 para separar trazas de identidad. Escaneado por ServiceName, la
-- misma clave de tenant que ya usan las trazas (no el UUID de experimento de PostgreSQL).

CREATE TABLE IF NOT EXISTS memtrace.scores
(
    ServiceName    LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId   String CODEC(ZSTD(1)),
    ItemIndex      UInt32,
    TraceId        Nullable(String) CODEC(ZSTD(1)),
    Name           LowCardinality(String) CODEC(ZSTD(1)),
    Value          String CODEC(ZSTD(1)), -- serializado; DataType dice cómo interpretarlo
    DataType       LowCardinality(String),
    Source         LowCardinality(String),
    Comment        Nullable(String) CODEC(ZSTD(1)),
    Input          String CODEC(ZSTD(3)),
    Output         Nullable(String) CODEC(ZSTD(3)),
    ExpectedOutput Nullable(String) CODEC(ZSTD(3)),
    Error          Nullable(String) CODEC(ZSTD(1)),
    CreatedAt      DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, ItemIndex, Name)
SETTINGS index_granularity = 8192;
