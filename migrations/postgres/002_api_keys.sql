-- Autenticación de agentes por API key (ADR-013, pieza 9): una key por experimento,
-- validada en el gateway de ingesta (ver auth-context.ts / ingest route) antes de reenviar al Collector.
-- Solo se guarda el hash (SHA-256); el valor en claro se muestra una única vez al crearla.

CREATE TABLE IF NOT EXISTS api_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    key_hash      TEXT NOT NULL UNIQUE,
    key_prefix    TEXT NOT NULL, -- primeros caracteres, solo para reconocer la key en la UI (no es secreto)
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_experiment ON api_keys(experiment_id) WHERE revoked_at IS NULL;
