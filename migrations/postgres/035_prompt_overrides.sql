-- Playground contra el asistente real (ADR-071). Para probar una versión de un prompt, MemTrace llama al chat del agente con
-- un token efímero; el SDK del agente lo presenta a MemTrace (con su API key) para obtener esa versión SOLO para esa
-- petición. El token es una capacidad: nace en MemTrace, caduca en minutos, está atado a un agente, un prompt y una versión,
-- y MemTrace es quien lo valida (no hay secreto compartido que guardar). Solo se guarda su hash. Idempotente.

CREATE TABLE IF NOT EXISTS prompt_overrides (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash       TEXT NOT NULL UNIQUE,
    experiment_id    UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    prompt_id        UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    version          INT NOT NULL CHECK (version >= 1),
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    -- cuántas veces el agente lo ha presentado: >0 demuestra que el agente aplicó el override
    resolved_count   INT NOT NULL DEFAULT 0,
    last_resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prompt_overrides_expires ON prompt_overrides(expires_at);
