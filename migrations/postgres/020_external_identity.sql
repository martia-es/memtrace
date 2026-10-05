-- Identidad externa (ADR-052, fases B y C): grupos del token OIDC y SCIM 2.0 asignan roles sin tocar las membresías manuales.
-- Idempotente.

-- De dónde viene cada membresía. Solo las que no son 'manual' las reconcilian el login OIDC o SCIM.
ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE experiment_memberships ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_source_check;
ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_source_check CHECK (source IN ('manual', 'oidc', 'scim'));
ALTER TABLE experiment_memberships DROP CONSTRAINT IF EXISTS experiment_memberships_source_check;
ALTER TABLE experiment_memberships ADD CONSTRAINT experiment_memberships_source_check CHECK (source IN ('manual', 'oidc', 'scim'));

-- Qué grupo del proveedor de identidad da qué rol. experiment_id NULL = rol de organización.
CREATE TABLE IF NOT EXISTS external_mappings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    external_group  TEXT NOT NULL,
    experiment_id   UUID REFERENCES experiments(id) ON DELETE CASCADE,
    role            TEXT NOT NULL REFERENCES roles(name),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (organization_id, external_group, experiment_id, role)
);
CREATE INDEX IF NOT EXISTS idx_external_mappings_org ON external_mappings(organization_id);

-- Cómo se llama la claim de grupos del token en esta organización (Entra: groups o roles; Okta: groups…).
CREATE TABLE IF NOT EXISTS organization_idp_settings (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    groups_claim    TEXT NOT NULL DEFAULT 'groups',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tokens de portador de SCIM, uno o varios por organización. Solo se guarda el hash.
CREATE TABLE IF NOT EXISTS scim_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    token_prefix    TEXT NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_org ON scim_tokens(organization_id) WHERE revoked_at IS NULL;

-- Recursos SCIM. Un usuario SCIM se enlaza a `users` por email, en el momento o en su primer login.
CREATE TABLE IF NOT EXISTS scim_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_name       TEXT NOT NULL,
    external_id     TEXT,
    display_name    TEXT,
    active          BOOLEAN NOT NULL DEFAULT true,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scim_users_name ON scim_users(organization_id, lower(user_name));

CREATE TABLE IF NOT EXISTS scim_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    external_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scim_groups_name ON scim_groups(organization_id, display_name);

CREATE TABLE IF NOT EXISTS scim_group_members (
    group_id     UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
    scim_user_id UUID NOT NULL REFERENCES scim_users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, scim_user_id)
);
