-- Invitaciones a personas sin cuenta todavía (ADR-014). Se guardan por email porque
-- Auth.js no crea el usuario hasta el primer login; se aplican y se borran en
-- events.createUser (api/src/auth.ts) cuando esa persona inicia sesión por primera vez.

CREATE TABLE IF NOT EXISTS pending_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    experiment_id   UUID REFERENCES experiments(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('org_admin', 'admin', 'member')),
    invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (organization_id IS NOT NULL AND experiment_id IS NULL AND role = 'org_admin')
        OR (experiment_id IS NOT NULL AND organization_id IS NULL AND role IN ('admin', 'member'))
    )
);

CREATE INDEX IF NOT EXISTS idx_pending_invitations_email ON pending_invitations(email);
