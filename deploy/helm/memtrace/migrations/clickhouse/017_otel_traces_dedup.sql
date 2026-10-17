-- Almacén de spans sin duplicados (ADR-099). Con entrega al menos una vez (ADR-098) el mismo span puede llegar dos veces; esta
-- tabla es `otel_traces` con el motor ReplacingMergeTree y la identidad del span en la clave de ordenación, de modo que las
-- copias se funden en una.
--
-- Solo CREA la tabla nueva. El cambio de una por otra (copiar el histórico, intercambiar y recoger lo que llegó entretanto) lo
-- hace el Job `dedupe-otel-traces` (api/src/worker/dedupe-otel-traces.ts), que se puede repetir y no necesita parar la ingesta:
-- aquí no cabe porque una migración es SQL fijo y esa operación tiene que comprobar el estado y esperar.
--
-- Identidad: (ServiceName, ExperimentId, TraceId, SpanId). El experimento forma parte de ella porque TraceId y SpanId los genera
-- el SDK del agente: sin él, quien tuviera una key válida podría pisar un span de otro cliente con los mismos ids (ADR-088).
-- La clave de ordenación completa es la que compara el motor; PRIMARY KEY es su prefijo (el de antes, con el experimento delante),
-- así que el índice y las consultas por servicio, experimento y hora siguen igual.
--
-- `AS memtrace.otel_traces` copia todas las columnas (con sus valores por defecto y códecs) y los índices.
CREATE TABLE IF NOT EXISTS memtrace.otel_traces_v2 AS memtrace.otel_traces
ENGINE = ReplacingMergeTree
PARTITION BY toDate(Timestamp)
PRIMARY KEY (ServiceName, ExperimentId, SpanName, toDateTime(Timestamp))
ORDER BY (ServiceName, ExperimentId, SpanName, toDateTime(Timestamp), TraceId, SpanId)
TTL toDateTime(Timestamp) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
