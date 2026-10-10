-- Relación partner entre organizaciones (ADR-080, opción A). Una consultora (organización partner) opera las
-- organizaciones de sus clientes sin que ser de la consultora dé acceso a nada: cada cliente decide, en su propia
-- organización, qué personas de la consultora entran, con qué rol y en qué experimentos.
--
-- El acceso es opt-in por cliente y lo concede y revoca el org_admin del CLIENTE. Un grant solo vale mientras la persona
-- siga siendo miembro de la organización partner: dar de baja a alguien en la consultora le quita el acceso a todos los
-- clientes a la vez. Nada se borra al revocar (`revoked_at`), para poder reconstruir quién tuvo acceso y cuándo.

CREATE TABLE IF NOT EXISTS organization_partnerships (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    partner_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by              UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at              TIMESTAMPTZ,
    revoked_by              UUID REFERENCES users(id),
    CHECK (client_organization_id <> partner_organization_id)
);

-- una sola relación activa por pareja cliente/partner
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_active
    ON organization_partnerships (client_organization_id, partner_organization_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_partnership_partner ON organization_partnerships (partner_organization_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS partner_grants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partnership_id UUID NOT NULL REFERENCES organization_partnerships(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- rol de experimento (`technical`, `business`…): nunca de organización, así que un partner no puede ser org_admin del cliente
    role           TEXT NOT NULL REFERENCES roles(name),
    -- NULL = todos los experimentos del cliente (también los que se creen después)
    experiment_id  UUID REFERENCES experiments(id) ON DELETE CASCADE,
    granted_by     UUID NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ,
    revoked_by     UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_grant_active
    ON partner_grants (partnership_id, user_id, COALESCE(experiment_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_partner_grant_user ON partner_grants (user_id) WHERE revoked_at IS NULL;
