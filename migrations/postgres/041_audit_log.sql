-- Registro de auditoría (ADR-080): quién abrió contenido de trazas, exportó datos o cambió accesos y configuración.
-- Solo se inserta: la aplicación no tiene camino de UPDATE ni de DELETE; el worker de retención purga lo más antiguo.
-- No guarda contenido, solo identificadores. El email del actor se copia (`actor_label`) para que la entrada sobreviva
-- al borrado del usuario. Idempotente.
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    experiment_id   UUID REFERENCES experiments(id) ON DELETE SET NULL,
    -- NULL = el sistema (p. ej. la purga de retención)
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_label     TEXT NOT NULL CHECK (length(actor_label) BETWEEN 1 AND 320),
    action          TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
    target_type     TEXT CHECK (target_type IS NULL OR length(target_type) <= 60),
    target_id       TEXT CHECK (target_id IS NULL OR length(target_id) <= 200),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_at ON audit_log (organization_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_experiment_at ON audit_log (experiment_id, at DESC) WHERE experiment_id IS NOT NULL;
