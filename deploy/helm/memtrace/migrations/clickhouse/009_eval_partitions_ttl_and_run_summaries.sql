-- Retención y agregados de la evaluación offline (ADR-045, cierra los pendientes de ADR-044 / límites 6 y 7 de ADR-042).
--
-- 1. eval_items y eval_scores pasan a particionarse por mes de CreatedAt, para poder borrar/mover datos viejos
--    por partición sin reescribir tablas. ClickHouse no permite cambiar PARTITION BY con ALTER: se crea la tabla
--    nueva, se copian las filas y se intercambian de forma atómica (EXCHANGE TABLES). Las filas que lleguen entre
--    la copia y el intercambio se perderían: la migración se aplica en el despliegue, con la API todavía sin servir
--    tráfico nuevo de subida, y reenviar un lote es idempotente (ADR-034).
-- 2. TTL de COLUMNA (180 días) solo sobre los textos pesados de eval_items (Input/Output/ExpectedOutput/Error): al
--    vencer, vuelven a su valor por defecto. Los scores, las tendencias y los resúmenes se conservan.
--    Cambiar el plazo: ALTER TABLE memtrace.eval_items MODIFY COLUMN Input String CODEC(ZSTD(3)) TTL toDateTime(CreatedAt) + INTERVAL <n> DAY.
-- 3. eval_run_summaries: agregado por (run, evaluador) escrito UNA vez cuando el run se completa (el run queda
--    cerrado, así que es exacto). No es una vista materializada a propósito: reenviar un lote (idempotente en las
--    tablas ReplacingMergeTree) sumaría dos veces en un agregado incremental.

CREATE TABLE IF NOT EXISTS memtrace.eval_items_v2
(
    ServiceName    LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId   String CODEC(ZSTD(1)),
    ItemIndex      UInt32,
    TraceId        Nullable(String) CODEC(ZSTD(1)),
    Input          String CODEC(ZSTD(3)) TTL toDateTime(CreatedAt) + INTERVAL 180 DAY,
    Output         Nullable(String) CODEC(ZSTD(3)) TTL toDateTime(CreatedAt) + INTERVAL 180 DAY,
    ExpectedOutput Nullable(String) CODEC(ZSTD(3)) TTL toDateTime(CreatedAt) + INTERVAL 180 DAY,
    Error          Nullable(String) CODEC(ZSTD(1)) TTL toDateTime(CreatedAt) + INTERVAL 180 DAY,
    CreatedAt      DateTime64(3) CODEC(Delta, ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(CreatedAt)
PARTITION BY toYYYYMM(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, ItemIndex)
SETTINGS index_granularity = 8192;

INSERT INTO memtrace.eval_items_v2 SELECT ServiceName, DatasetRunId, ItemIndex, TraceId, Input, Output, ExpectedOutput, Error, CreatedAt FROM memtrace.eval_items;
EXCHANGE TABLES memtrace.eval_items AND memtrace.eval_items_v2;
DROP TABLE memtrace.eval_items_v2;

CREATE TABLE IF NOT EXISTS memtrace.eval_scores_v2
(
    ServiceName     LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId    String CODEC(ZSTD(1)),
    ItemIndex       UInt32,
    Name            LowCardinality(String) CODEC(ZSTD(1)),
    Value           String CODEC(ZSTD(1)),
    ValueNum        Nullable(Float64),
    DataType        LowCardinality(String),
    Source          LowCardinality(String),
    Comment         Nullable(String) CODEC(ZSTD(1)),
    JudgeModel      Nullable(String) CODEC(ZSTD(1)),
    JudgePromptHash Nullable(String) CODEC(ZSTD(1)),
    CreatedAt       DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(CreatedAt)
PARTITION BY toYYYYMM(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, ItemIndex, Name)
SETTINGS index_granularity = 8192;

INSERT INTO memtrace.eval_scores_v2 SELECT ServiceName, DatasetRunId, ItemIndex, Name, Value, ValueNum, DataType, Source, Comment, JudgeModel, JudgePromptHash, CreatedAt FROM memtrace.eval_scores;
EXCHANGE TABLES memtrace.eval_scores AND memtrace.eval_scores_v2;
DROP TABLE memtrace.eval_scores_v2;

CREATE TABLE IF NOT EXISTS memtrace.eval_run_summaries
(
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    DatasetRunId String CODEC(ZSTD(1)),
    Name        LowCardinality(String) CODEC(ZSTD(1)),
    DataType    LowCardinality(String),
    Total       UInt64,
    AvgValue    Nullable(Float64),                       -- media de ValueNum (boolean: tasa de aprobados); NULL en categorical
    Judges      Array(Tuple(Nullable(String), Nullable(String))),  -- (modelo, huella de la rúbrica) distintos, ADR-043
    CreatedAt   DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(CreatedAt)
ORDER BY (ServiceName, DatasetRunId, Name)
SETTINGS index_granularity = 8192;
