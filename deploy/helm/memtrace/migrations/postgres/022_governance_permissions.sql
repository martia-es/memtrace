-- Permisos de gobernanza de asistentes (ADR-053). Idempotente.
--   governance:read    catálogo de asistentes de la organización (solo metadatos)
--   governance:manage  aprobar conexiones y decidir quién puede llamar a cada entorno
--   assistant:manage   mantener la ficha y los despliegues del asistente propio

INSERT INTO roles (name, scope, builtin) VALUES ('governance', 'organization', true) ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_name, permission) VALUES
    ('org_admin',  'governance:read'),
    ('org_admin',  'governance:manage'),
    ('governance', 'governance:read'),
    ('governance', 'governance:manage'),
    ('technical',  'assistant:manage')
ON CONFLICT DO NOTHING;
