-- Aprobaciones de prompts (ADR-076): publicar una versión (el "pull request" del prompt) y promoverla a un entorno pueden
-- exigir que otras personas las aprueben antes de ejecutarse. Es opt-in: sin reglas, todo funciona como antes.
-- Las reglas viven en la organización (suelo) y en el experimento (solo pueden endurecerla). Idempotente.

-- `prompt:approve`: poder aprobar o rechazar solicitudes. `approval:manage`: definir las reglas (organización y experimento).
INSERT INTO role_permissions (role_name, permission) VALUES
    ('technical', 'prompt:approve'),
    ('business',  'prompt:approve'),
    ('org_admin', 'approval:manage')
ON CONFLICT DO NOTHING;

-- Una regla = qué hace falta para UNA acción en UN paso. `publish` no tiene paso (stage = ''); `promote` lleva la clave del
-- entorno de destino (dev, pre, pro…). Que la regla exista significa que la acción exige aprobación.
CREATE TABLE IF NOT EXISTS approval_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    experiment_id   UUID REFERENCES experiments(id) ON DELETE CASCADE,
    action          TEXT NOT NULL CHECK (action IN ('publish', 'promote')),
    stage           TEXT NOT NULL DEFAULT '',
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- exactamente un ámbito: la organización o un experimento
    CHECK ((organization_id IS NOT NULL) <> (experiment_id IS NOT NULL)),
    CHECK ((action = 'publish' AND stage = '') OR (action = 'promote' AND stage <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_rules_org ON approval_rules (organization_id, action, stage) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_rules_experiment ON approval_rules (experiment_id, action, stage) WHERE experiment_id IS NOT NULL;

-- "Hacen falta N aprobaciones de personas con el perfil R" (R = nombre de un rol de experimento: technical, business…).
CREATE TABLE IF NOT EXISTS approval_rule_requirements (
    rule_id       UUID NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
    role          TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
    min_approvals INT NOT NULL CHECK (min_approvals BETWEEN 1 AND 10),
    PRIMARY KEY (rule_id, role)
);

-- Aprobadores por defecto: personas concretas que tienen que aprobar sí o sí.
CREATE TABLE IF NOT EXISTS approval_rule_approvers (
    rule_id UUID NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, user_id)
);

-- La solicitud: publicar la versión `version` del prompt, o apuntar el tag `tag` a ella.
CREATE TABLE IF NOT EXISTS approval_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id       UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    action          TEXT NOT NULL CHECK (action IN ('publish', 'promote')),
    version         INT NOT NULL CHECK (version >= 1),
    tag             TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    -- el motivo para saltarse el gate de evaluación (ADR-070), si quien pide tiene permiso: se aplica al ejecutar
    bypass_reason   TEXT,
    requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed')),
    execution_error TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    decided_at      TIMESTAMPTZ,
    executed_at     TIMESTAMPTZ,
    -- quien ejecuta la acción la reserva antes (UPDATE condicional): dos aprobaciones a la vez no la ejecutan dos veces. La reserva
    -- caduca (2 min) por si el proceso muere a mitad, y se libera si la ejecución falla para poder reintentarla.
    claimed_at      TIMESTAMPTZ,
    FOREIGN KEY (prompt_id, version) REFERENCES prompt_versions(prompt_id, version) ON DELETE CASCADE,
    CHECK ((action = 'publish' AND tag = '') OR (action = 'promote' AND tag <> ''))
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_prompt ON approval_requests (prompt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests (status) WHERE status IN ('pending', 'approved');
-- una sola solicitud viva por destino: no se apilan peticiones iguales
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_requests_open ON approval_requests (prompt_id, action, version, tag) WHERE status IN ('pending', 'approved');

-- Aprobadores añadidos a ESTA solicitud sobre la marcha: tienen que aprobar además de los de la regla.
CREATE TABLE IF NOT EXISTS approval_request_approvers (
    request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, user_id)
);

-- Una decisión por persona y solicitud. Un rechazo cierra la solicitud.
CREATE TABLE IF NOT EXISTS approval_decisions (
    request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision   TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
    comment    TEXT NOT NULL DEFAULT '',
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, user_id)
);
