-- Despliegues lanzados desde MemTrace (ADR-064). MemTrace no despliega: dispara el CI del repositorio del agente y
-- guarda aquí qué pidió, con qué commit, quién, y cómo acabó. Idempotente.
--
-- Permiso `deploy:run` para el perfil técnico del experimento. Saltarse el gate (hotfix) exige además
-- `governance:manage`, que ya tienen org_admin y governance.

INSERT INTO role_permissions (role_name, permission) VALUES ('technical', 'deploy:run') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS deploy_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id    UUID NOT NULL REFERENCES assistant_deployments(id) ON DELETE CASCADE,
    experiment_id    UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    commit_sha       TEXT NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{7,64}$'),
    ref              TEXT NOT NULL,
    requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    -- veredicto del gate cuando se pidió (ADR-064) y, si se saltó, quién lo justificó y por qué
    gate_verdict     TEXT NOT NULL,
    gate_bypassed    BOOLEAN NOT NULL DEFAULT false,
    bypass_reason    TEXT,
    provider_run_url TEXT,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    CONSTRAINT deploy_runs_bypass_reason CHECK (NOT gate_bypassed OR (bypass_reason IS NOT NULL AND length(btrim(bypass_reason)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_deploy_runs_deployment ON deploy_runs(deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_runs_experiment_ok ON deploy_runs(experiment_id) WHERE status = 'succeeded';
