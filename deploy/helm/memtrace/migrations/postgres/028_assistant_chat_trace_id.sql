-- Feedback de usuario final (ADR-062): clave del JSON de respuesta del chat que lleva el id de la traza de esa respuesta
-- (admite ruta con puntos). Con ella el panel «Talk» de MemTrace ofrece 👍/👎 en cada respuesta; NULL = el agente no la
-- devuelve y no se ofrece. Idempotente.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS chat_trace_id_field TEXT;
