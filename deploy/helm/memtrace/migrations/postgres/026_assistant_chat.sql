-- Endpoint de chat del agente (ADR-055). Vive en el experimento, no en el despliegue: el path (`/api/chat`) es el mismo en
-- DEV/PRE/PRO y solo cambia el host (`assistant_deployments.api_url`). Los tres campos describen el contrato JSON del
-- asistente para que el proxy de MemTrace traduzca el mensaje sin obligar a nadie a cambiar su API. Idempotente.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS chat_path           TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS chat_request_field  TEXT NOT NULL DEFAULT 'message';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS chat_response_field TEXT NOT NULL DEFAULT 'reply';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS chat_session_field  TEXT;
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_chat_path_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_chat_path_check CHECK (chat_path IS NULL OR chat_path LIKE '/%');
