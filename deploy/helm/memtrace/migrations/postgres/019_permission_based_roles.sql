-- Roles como datos y permisos por rol (ADR-052). El código solo comprueba permisos; añadir un perfil es añadir filas.
-- Idempotente: se puede relanzar sin duplicar ni degradar nada.

CREATE TABLE IF NOT EXISTS roles (
    name    TEXT PRIMARY KEY,
    scope   TEXT NOT NULL CHECK (scope IN ('organization', 'experiment')),
    builtin BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_name  TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_name, permission)
);

INSERT INTO roles (name, scope, builtin) VALUES
    ('org_admin', 'organization', true),
    ('technical', 'experiment', true),
    ('business',  'experiment', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_name, permission) VALUES
    ('org_admin', 'org:manage'),
    ('org_admin', 'experiment:create'),
    ('org_admin', 'member:manage'),
    ('org_admin', 'apikey:manage_all'),
    ('technical', 'experiment:read'),
    ('technical', 'trace:read_technical'),
    ('technical', 'annotation:write'),
    ('technical', 'queue:manage'),
    ('technical', 'queue:curate'),
    ('technical', 'scoreconfig:manage'),
    ('technical', 'dataset:write'),
    ('technical', 'apikey:manage_own'),
    ('business', 'experiment:read'),
    ('business', 'annotation:write')
ON CONFLICT DO NOTHING;

-- Los roles de experimento antiguos (admin / member) pasan a technical: nadie pierde acceso. Pasar a business es explícito.
ALTER TABLE experiment_memberships DROP CONSTRAINT IF EXISTS experiment_memberships_role_check;
UPDATE experiment_memberships SET role = 'technical' WHERE role IN ('admin', 'member');

ALTER TABLE pending_invitations DROP CONSTRAINT IF EXISTS pending_invitations_role_check;
ALTER TABLE pending_invitations DROP CONSTRAINT IF EXISTS pending_invitations_check;
UPDATE pending_invitations SET role = 'technical' WHERE role IN ('admin', 'member');
ALTER TABLE pending_invitations DROP CONSTRAINT IF EXISTS pending_invitations_target_check;
ALTER TABLE pending_invitations ADD CONSTRAINT pending_invitations_target_check CHECK (
    (organization_id IS NOT NULL AND experiment_id IS NULL AND role = 'org_admin')
    OR (experiment_id IS NOT NULL AND organization_id IS NULL AND role <> 'org_admin')
);

ALTER TABLE experiment_memberships DROP CONSTRAINT IF EXISTS experiment_memberships_role_fkey;
ALTER TABLE experiment_memberships ADD CONSTRAINT experiment_memberships_role_fkey FOREIGN KEY (role) REFERENCES roles(name);
ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_role_check;
ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_role_fkey;
ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_role_fkey FOREIGN KEY (role) REFERENCES roles(name);
ALTER TABLE pending_invitations DROP CONSTRAINT IF EXISTS pending_invitations_role_fkey;
ALTER TABLE pending_invitations ADD CONSTRAINT pending_invitations_role_fkey FOREIGN KEY (role) REFERENCES roles(name);

-- Los org_admin existentes leían todo por su rol. Para que nadie pierda acceso al desplegar, se les da `technical` en los
-- experimentos de su organización; pueden quitárselo después. Sin pisar una membership que ya tengan.
INSERT INTO experiment_memberships (experiment_id, user_id, role)
SELECT e.id, om.user_id, 'technical'
  FROM org_memberships om JOIN experiments e ON e.organization_id = om.organization_id
ON CONFLICT (experiment_id, user_id) DO NOTHING;
