-- Retención de trazas (ADR-084): el TTL por tabla deja de ser el plazo real y pasa a ser el TECHO (365 días). El plazo de
-- cada organización/experimento (por defecto 30 días, igual que antes) lo aplica un CronJob diario con DELETE por
-- ServiceName, porque un TTL de tabla no puede variar por tenant. Con los valores por defecto nada cambia.
ALTER TABLE memtrace.otel_traces MODIFY TTL toDateTime(Timestamp) + toIntervalDay(365);
ALTER TABLE memtrace.otel_traces_trace_id_ts MODIFY TTL toDateTime(Start) + toIntervalDay(365);
ALTER TABLE memtrace.span_topics MODIFY TTL toDateTime(ExtractedAt) + toIntervalDay(365);
