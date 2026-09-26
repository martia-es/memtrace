-- Id de conversación como columna real (ADR-012).
-- Antes vivía solo dentro del mapa SpanAttributes: leerlo obligaba a leer el mapa entero de cada span.
-- Es MATERIALIZED: se calcula al insertar a partir del atributo estándar `gen_ai.conversation.id`,
-- así que el exporter del Collector (que inserta con lista explícita de columnas) no cambia.
ALTER TABLE memtrace.otel_traces
    ADD COLUMN IF NOT EXISTS ConversationId String MATERIALIZED SpanAttributes['gen_ai.conversation.id'] CODEC(ZSTD(1)),
    ADD INDEX IF NOT EXISTS idx_conversation_id ConversationId TYPE bloom_filter(0.01) GRANULARITY 1;

-- Los datos ya guardados no tienen la columna física (se calcula al leer): se reescriben en segundo plano
ALTER TABLE memtrace.otel_traces MATERIALIZE COLUMN ConversationId;
ALTER TABLE memtrace.otel_traces MATERIALIZE INDEX idx_conversation_id;
