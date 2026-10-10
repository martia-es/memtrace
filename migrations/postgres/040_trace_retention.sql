-- Retención de trazas configurable (ADR-084): un valor por organización y, opcionalmente, uno más corto por experimento.
-- El plazo efectivo es min(override, organización); el TTL de ClickHouse queda como techo (migración clickhouse 013) y un
-- CronJob diario borra por experimento lo que lo supere. Idempotente.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trace_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (trace_retention_days BETWEEN 1 AND 365);
-- NULL = sin override: vale el de la organización
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS trace_retention_days INTEGER
    CHECK (trace_retention_days IS NULL OR trace_retention_days BETWEEN 1 AND 365);

-- `retention:manage` cambia los plazos y `audit:read` consulta el registro de auditoría: de organización, solo org_admin
-- (que gestiona personas y configuración pero no lee datos). `data:export` saca datos de un experimento: lo tiene el perfil
-- que ya los ve, `technical`. Al ser permisos de un rol-dato se pueden dar o quitar sin tocar código (ADR-052).
INSERT INTO role_permissions (role_name, permission) VALUES
    ('org_admin', 'retention:manage'),
    ('org_admin', 'audit:read'),
    ('technical', 'data:export')
ON CONFLICT DO NOTHING;
