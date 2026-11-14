-- Descubrimiento de Mem (Fase 2.1): reglas que explican los fallos recurrentes de un agente.
--
-- 1) `mem_episodes` gana dos columnas que el descubrimiento necesita para generalizar sin conocer el agente:
--    `Attributes` (atributos de la traza con poco texto y sin identificadores: idioma, versión de la app...) y
--    `EmptyArgTools` (herramientas llamadas con algún argumento vacío). Los episodios ya escritos las tienen vacías hasta
--    que el worker los recalcula: `EPISODE_VERSION` sube a 2 y los recalcula solo.
ALTER TABLE memtrace.mem_episodes
    ADD COLUMN IF NOT EXISTS Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ADD COLUMN IF NOT EXISTS EmptyArgTools Array(LowCardinality(String)) CODEC(ZSTD(1));

-- 2) Una pasada de descubrimiento por organización/experimento y agente. Tablas DERIVADAS: se pueden borrar y reconstruir.
--    Cada pasada escribe una fila en `mem_discovery_runs` y las suyas en `mem_findings`; la lectura toma la última pasada.
CREATE TABLE IF NOT EXISTS memtrace.mem_discovery_runs
(
    ServiceName      LowCardinality(String) CODEC(ZSTD(1)),
    ExperimentId     LowCardinality(String) CODEC(ZSTD(1)),
    RunAt            DateTime64(3) CODEC(Delta, ZSTD(1)),
    WindowDays       UInt16,
    Episodes         UInt32,
    Failed           UInt32,
    Unexplained      UInt32,                                      -- fallos que ninguna regla explica
    UnexplainedTop   Map(String, UInt32) CODEC(ZSTD(1)),          -- sus errores más frecuentes
    GoalClusters     UInt16,                                      -- 0 = sin agrupar objetivos
    DiscoveryVersion UInt16
)
ENGINE = ReplacingMergeTree(RunAt)
ORDER BY (ServiceName, ExperimentId, RunAt)
TTL toDateTime(RunAt) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS memtrace.mem_findings
(
    ServiceName       LowCardinality(String) CODEC(ZSTD(1)),
    ExperimentId      LowCardinality(String) CODEC(ZSTD(1)),
    RunAt             DateTime64(3) CODEC(Delta, ZSTD(1)),
    FindingId         String CODEC(ZSTD(1)),                      -- hash estable de la causa y la regla
    Cause             String CODEC(ZSTD(1)),                      -- «paso | error» o «(sin error)»
    Rule              String CODEC(ZSTD(1)),                      -- condición legible, por ejemplo «n_steps <= 2.5»
    Support           UInt32,                                     -- episodios que cumplen la regla
    Failures          UInt32,                                     -- de ellos, fallos de esta causa
    FailureRate       Float32,
    Lift              Float32,
    PValue            Float64,
    DecisiveStep      String CODEC(ZSTD(1)),
    DecisiveError     String CODEC(ZSTD(1)),
    ToolSequence      String CODEC(ZSTD(1)),
    OccurrenceByPrompt Map(String, Float32) CODEC(ZSTD(1)),       -- por 100 trazas y versión de prompt: sirve para ver si un fallo caduca
    ExampleTraceIds   Array(String) CODEC(ZSTD(1)),
    DiscoveryVersion  UInt16
)
ENGINE = ReplacingMergeTree(RunAt)
ORDER BY (ServiceName, ExperimentId, RunAt, FindingId)
TTL toDateTime(RunAt) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
