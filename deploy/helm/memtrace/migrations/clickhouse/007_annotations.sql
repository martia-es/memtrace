-- Anotaciones humanas (ADR-037): etiquetas de personas sobre trazas (y, reservado, items de un run).
-- Tabla aparte de `scores` a propósito: las anotaciones se editan y se retiran, y varias personas
-- pueden etiquetar lo mismo; `scores` es append-only y su clave garantiza la idempotencia de ADR-034.
--
-- Identidad de una etiqueta = (objetivo, span, config, anotador): reenviar la misma sustituye a la
-- anterior (edición); anotadores y configs distintos conviven. Retirar = insertar la misma clave con
-- IsDeleted = 1 y un CreatedAt posterior. Toda lectura usa FINAL + IsDeleted = 0. Sin TTL: una
-- anotación debe sobrevivir a la retención de trazas.

CREATE TABLE IF NOT EXISTS memtrace.annotations
(
    ServiceName    LowCardinality(String) CODEC(ZSTD(1)),
    TargetType     LowCardinality(String),                  -- 'trace' | 'run_item' (fase A solo expone 'trace')
    TraceId        String CODEC(ZSTD(1)),                   -- '' si TargetType = 'run_item' sin traza
    SpanId         String CODEC(ZSTD(1)),                   -- '' = la traza entera
    DatasetRunId   String CODEC(ZSTD(1)),                   -- '' salvo TargetType = 'run_item'
    ItemIndex      UInt32,                                  -- 0 salvo TargetType = 'run_item'
    ConfigId       String,                                  -- score_configs.id (PostgreSQL, sin FK)
    ConfigName     LowCardinality(String),                  -- desnormalizado: clave de unión con scores.Name
    DataType       LowCardinality(String),                  -- copiado de la config al escribir
    AnnotatorId    String,                                  -- users.id (PostgreSQL)
    Value          String CODEC(ZSTD(1)),                   -- serializado igual que scores.Value
    Comment        Nullable(String) CODEC(ZSTD(1)),
    CreatedAt      DateTime64(3) CODEC(Delta, ZSTD(1)),     -- columna de versión: gana la última escritura
    IsDeleted      UInt8 DEFAULT 0                          -- lápida de retirada
)
ENGINE = ReplacingMergeTree(CreatedAt, IsDeleted)
ORDER BY (ServiceName, TargetType, TraceId, DatasetRunId, ItemIndex, SpanId, ConfigId, AnnotatorId)
SETTINGS index_granularity = 8192;
