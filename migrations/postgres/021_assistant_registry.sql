-- Registro de asistentes para gobernanza de la IA (ADR-053): ficha por experimento, despliegues por entorno,
-- estado de salud (/health), conexiones declaradas/observadas y quién puede llamar a cada despliegue.
-- Las métricas observadas (llamadas, errores de cada tool) NO se guardan aquí: se calculan desde ClickHouse al consultar.
-- Idempotente: se puede relanzar sin duplicar nada.

-- Entornos configurables por organización (por defecto DEV / PRE / PRO).
CREATE TABLE IF NOT EXISTS environments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key                     TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{0,31}$'),
    label                   TEXT NOT NULL,
    position                INT NOT NULL DEFAULT 0,
    is_production           BOOLEAN NOT NULL DEFAULT false,
    -- intervalo de sondeo por defecto de /health para los despliegues de este entorno
    health_interval_seconds INT NOT NULL DEFAULT 300 CHECK (health_interval_seconds >= 15),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, key)
);

INSERT INTO environments (organization_id, key, label, position, is_production, health_interval_seconds)
SELECT o.id, d.key, d.label, d.position, d.is_production, d.health_interval_seconds
  FROM organizations o
 CROSS JOIN (VALUES
    ('dev', 'DEV', 0, false, 300),
    ('pre', 'PRE', 1, false, 300),
    ('pro', 'PRO', 2, true, 60)
 ) AS d(key, label, position, is_production, health_interval_seconds)
ON CONFLICT (organization_id, key) DO NOTHING;

-- Ficha del asistente: 1:1 con el experimento (el nombre es el del experimento). Se registra de forma explícita.
CREATE TABLE IF NOT EXISTS assistants (
    experiment_id UUID PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
    description   TEXT NOT NULL DEFAULT '',
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    team          TEXT,
    lifecycle     TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'retired')),
    registered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Despliegue de un asistente en un entorno. El entorno debe ser de la misma organización que el experimento (lo valida el
-- repositorio: una FK compuesta obligaría a duplicar organization_id en `assistants`).
-- Nunca se guardan secretos: solo cómo se autentica (método, proveedor, audiencia).
CREATE TABLE IF NOT EXISTS assistant_deployments (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id               UUID NOT NULL REFERENCES assistants(experiment_id) ON DELETE CASCADE,
    environment_id              UUID NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
    api_url                     TEXT NOT NULL CHECK (api_url ~ '^https?://'),
    -- NULL = api_url + '/health'
    health_url                  TEXT CHECK (health_url IS NULL OR health_url ~ '^https?://'),
    version                     TEXT,
    auth_method                 TEXT NOT NULL DEFAULT 'none' CHECK (auth_method IN ('none', 'api_key', 'oauth2', 'mtls', 'other')),
    auth_provider               TEXT,
    auth_audience               TEXT,
    health_check_enabled        BOOLEAN NOT NULL DEFAULT true,
    -- NULL = el intervalo del entorno
    health_interval_seconds     INT CHECK (health_interval_seconds IS NULL OR health_interval_seconds >= 15),
    -- Estado actual (lo escribe el worker de sondeo); el historial está en deployment_health_checks.
    health_status               TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('up', 'degraded', 'down', 'unknown')),
    health_checked_at           TIMESTAMPTZ,
    health_status_since         TIMESTAMPTZ,
    health_latency_ms           INT,
    health_consecutive_failures INT NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, environment_id)
);
CREATE INDEX IF NOT EXISTS idx_assistant_deployments_environment ON assistant_deployments(environment_id);
-- El worker busca qué despliegues tocan sondear.
CREATE INDEX IF NOT EXISTS idx_assistant_deployments_due ON assistant_deployments(health_checked_at) WHERE health_check_enabled;

-- Historial de sondeos. Volumen alto (1 fila por sondeo): el worker borra lo anterior a la retención (30 días por defecto).
CREATE TABLE IF NOT EXISTS deployment_health_checks (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deployment_id UUID NOT NULL REFERENCES assistant_deployments(id) ON DELETE CASCADE,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status        TEXT NOT NULL CHECK (status IN ('up', 'degraded', 'down', 'unknown')),
    latency_ms    INT,
    http_status   INT,
    error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deployment_health_checks_recent ON deployment_health_checks(deployment_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_health_checks_prune ON deployment_health_checks(checked_at);

-- Conexiones del asistente: servidores MCP, tools y agentes con los que habla. Una fila existe porque el dueño la declaró,
-- porque se vio en trazas, o ambas. Guarda el estado de gobernanza; los contadores salen de ClickHouse.
CREATE TABLE IF NOT EXISTS assistant_connections (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id      UUID NOT NULL REFERENCES assistants(experiment_id) ON DELETE CASCADE,
    kind               TEXT NOT NULL CHECK (kind IN ('mcp_server', 'tool', 'agent')),
    name               TEXT NOT NULL,
    -- solo tools: servidor MCP que la expone (NULL = función local)
    via                TEXT,
    -- solo agentes: el asistente del catálogo con el que habla (NULL = agente ajeno al catálogo)
    peer_experiment_id UUID REFERENCES assistants(experiment_id) ON DELETE SET NULL,
    declared           BOOLEAN NOT NULL DEFAULT false,
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
    first_seen_at      TIMESTAMPTZ,
    last_seen_at       TIMESTAMPTZ,
    decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at         TIMESTAMPTZ,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, kind, name),
    CHECK (via IS NULL OR kind = 'tool'),
    CHECK (peer_experiment_id IS NULL OR kind = 'agent'),
    CHECK (declared OR first_seen_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_assistant_connections_review ON assistant_connections(experiment_id) WHERE status = 'pending';

-- Quién puede llamar a un despliegue: usuarios, grupos del proveedor de identidad o toda la organización. MemTrace lo
-- documenta y lo sincroniza; no lo hace cumplir (no es el gateway del asistente).
CREATE TABLE IF NOT EXISTS deployment_access_grants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id  UUID NOT NULL REFERENCES assistant_deployments(id) ON DELETE CASCADE,
    subject_type   TEXT NOT NULL CHECK (subject_type IN ('user', 'group', 'everyone')),
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    -- mismo identificador de grupo que external_mappings.external_group (ADR-052)
    external_group TEXT,
    member_count   INT,
    source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'oidc', 'scim')),
    synced_at      TIMESTAMPTZ,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (subject_type = 'user' AND user_id IS NOT NULL AND external_group IS NULL)
        OR (subject_type = 'group' AND external_group IS NOT NULL AND user_id IS NULL)
        OR (subject_type = 'everyone' AND user_id IS NULL AND external_group IS NULL)
    ),
    UNIQUE NULLS NOT DISTINCT (deployment_id, subject_type, user_id, external_group)
);
