-- Registro de auditoría de acciones de seguridad (ADR-082): quién concedió o quitó acceso, quién creó o revocó una API key
-- y cuándo una persona de una consultora abrió los datos de un cliente. Sirve a la lectura del propio cliente
-- (`GET /organizations/{id}/audit`), no solo a la operación.
--
-- Es append-only: un trigger impide UPDATE y DELETE. Sin claves foráneas a propósito: el rastro tiene que sobrevivir a que
-- se borre el experimento, la organización o la persona (por eso guarda también el email del actor en ese momento).

CREATE TABLE IF NOT EXISTS audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id   UUID,
    actor_email     TEXT,
    action          TEXT NOT NULL,
    organization_id UUID,
    experiment_id   UUID,
    target_type     TEXT,
    target_id       TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_org_at ON audit_events (organization_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_experiment_at ON audit_events (experiment_id, at DESC);

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
