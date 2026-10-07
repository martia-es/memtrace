-- Feedback del usuario final (ADR-062): 👍/👎 que la persona que habla con el agente da a una respuesta.
-- Tabla aparte de `annotations` a propósito: quien vota no es un miembro de MemTrace (no hay users.id ni
-- rúbrica), solo un pseudónimo que manda el agente.
--
-- Identidad de un voto = (traza, span, usuario final): reenviarlo lo sustituye (cambiar de opinión);
-- retirarlo = misma clave con IsDeleted = 1 y un CreatedAt posterior. Toda lectura usa FINAL + IsDeleted = 0.
-- Sin TTL: el feedback debe sobrevivir a la retención de trazas.

CREATE TABLE IF NOT EXISTS memtrace.user_feedback
(
    ServiceName       LowCardinality(String) CODEC(ZSTD(1)),
    TraceId           String CODEC(ZSTD(1)),
    SpanId            String CODEC(ZSTD(1)),                 -- '' = la respuesta entera
    EndUserId         String CODEC(ZSTD(1)),                 -- pseudónimo del agente; '' = anónimo (un voto por traza)
    Rating            Int8,                                  -- 1 (👍) | -1 (👎)
    Comment           Nullable(String) CODEC(ZSTD(1)),
    ExternalMessageId String CODEC(ZSTD(1)),                 -- id del mensaje en la app del agente (opcional, solo metadato)
    CreatedAt         DateTime64(3) CODEC(Delta, ZSTD(1)),   -- columna de versión: gana la última escritura
    IsDeleted         UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(CreatedAt, IsDeleted)
ORDER BY (ServiceName, TraceId, SpanId, EndUserId)
SETTINGS index_granularity = 8192;
