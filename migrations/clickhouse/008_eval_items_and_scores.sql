-- Modelo de almacenamiento de la evaluación offline (ADR-044, que resuelve las limitaciones de ADR-042).
-- Sustituye a `scores` (una fila por run × item × evaluador con el texto del item repetido en cada una)
-- por dos tablas con la cardinalidad correcta:
--   * eval_items:  una fila por (run, item) — el texto del item se guarda UNA vez.
--   * eval_scores: una fila por (run, item, evaluador) — sin texto, con el valor tipado.
-- Latencia, tokens y coste NO se guardan aquí: se leen de la traza enlazada por `TraceId` (otel_traces),
-- que llega de forma asíncrona y puede no existir cuando el SDK sube el item.
-- Se descarta `scores` sin migrar sus datos: es un entorno de desarrollo y se parte de cero (ADR-044).
-- Las anotaciones de trazas no se tocan; las de items de run (`TargetType = 'run_item'`) se borran porque
-- sus runs desaparecen (migrations/postgres/016_reset_dataset_runs.sql).

DROP TABLE IF EXISTS memtrace.scores;

ALTER TABLE memtrace.annotations DELETE WHERE TargetType = 'run_item';

CREATE TABLE IF NOT EXISTS memtrace.eval_items
(
    ServiceName    LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId   String CODEC(ZSTD(1)),
    ItemIndex      UInt32,
    TraceId        Nullable(String) CODEC(ZSTD(1)),
    Input          String CODEC(ZSTD(3)),
    Output         Nullable(String) CODEC(ZSTD(3)),
    ExpectedOutput Nullable(String) CODEC(ZSTD(3)),
    Error          Nullable(String) CODEC(ZSTD(1)),
    CreatedAt      DateTime64(3) CODEC(Delta, ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, ItemIndex)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS memtrace.eval_scores
(
    ServiceName     LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId    String CODEC(ZSTD(1)),
    ItemIndex       UInt32,
    Name            LowCardinality(String) CODEC(ZSTD(1)),
    Value           String CODEC(ZSTD(1)),                   -- serializado tal como lo envió el SDK ("true", "0.8", "cat")
    ValueNum        Nullable(Float64),                       -- numeric: el número; boolean: 1/0; categorical: NULL
    DataType        LowCardinality(String),
    Source          LowCardinality(String),
    Comment         Nullable(String) CODEC(ZSTD(1)),
    JudgeModel      Nullable(String) CODEC(ZSTD(1)),         -- ADR-043
    JudgePromptHash Nullable(String) CODEC(ZSTD(1)),         -- ADR-043
    CreatedAt       DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, ItemIndex, Name)
SETTINGS index_granularity = 8192;
