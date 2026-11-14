-- Episodios de Mem (Fase 2.0, Observar): una fila por traza con sus pasos, el paso decisivo y un resultado multi-señal
-- (error, bucle, evaluador, feedback del usuario). Los rellena el worker `analytics/mem`; la API solo lee.
--
-- Es una tabla DERIVADA: se puede borrar y reconstruir desde `otel_traces`, `user_feedback` y `scores`. Por eso no se
-- guarda nada que no esté ya en las trazas, y por eso hay `EpisodeVersion`: si cambian los pesos o los umbrales del
-- resultado, el worker recalcula los episodios de la versión anterior.
-- `Goal` y `Answer` salen de los mensajes de la traza, que ya pasaron por el enmascarado de datos personales del SDK
-- (ADR-084); se recortan a 500 caracteres y siguen la retención de las trazas: el TTL de la tabla es el techo (365 días,
-- como `span_topics` tras la 013) y el plazo real de cada organización lo aplica el CronJob de retención.
--
-- Una traza se vuelve a escribir cuando llega una señal tardía (un 👎, una puntuación): gana la última `BuiltAt`.
-- Las lecturas usan FINAL.
CREATE TABLE IF NOT EXISTS memtrace.mem_episodes
(
    ServiceName       LowCardinality(String) CODEC(ZSTD(1)),
    ExperimentId      LowCardinality(String) CODEC(ZSTD(1)),   -- aislamiento entre organizaciones (ADR-088): el nombre de servicio no basta
    TraceId           String CODEC(ZSTD(1)),
    ConversationId    String CODEC(ZSTD(1)),
    StartedAt         DateTime64(3) CODEC(Delta, ZSTD(1)),
    Revision          LowCardinality(String) CODEC(ZSTD(1)),
    PromptName        LowCardinality(String) CODEC(ZSTD(1)),
    PromptVersion     UInt32 CODEC(ZSTD(1)),
    Model             LowCardinality(String) CODEC(ZSTD(1)),
    Goal              String CODEC(ZSTD(3)),
    Answer            String CODEC(ZSTD(3)),
    Steps             Array(LowCardinality(String)) CODEC(ZSTD(1)),
    NChat             UInt16,
    NTools            UInt16,
    DecisiveSpanId    String CODEC(ZSTD(1)),
    DecisiveStep      LowCardinality(String) CODEC(ZSTD(1)),
    DecisiveError     String CODEC(ZSTD(1)),
    DecisiveException LowCardinality(String) CODEC(ZSTD(1)),
    HasError          UInt8,
    Loop              UInt8,
    Thumbs            Int8,
    EvalScore         Nullable(Float32),
    Value             Float32,
    Outcome           LowCardinality(String),
    Reasons           Array(LowCardinality(String)) CODEC(ZSTD(1)),
    EpisodeVersion    UInt16,
    BuiltAt           DateTime64(3) CODEC(Delta, ZSTD(1)),
    INDEX idx_outcome Outcome TYPE set(4) GRANULARITY 1,
    INDEX idx_decisive_step DecisiveStep TYPE set(100) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(BuiltAt)
PARTITION BY toDate(StartedAt)
ORDER BY (ServiceName, ExperimentId, TraceId)
TTL toDateTime(StartedAt) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
