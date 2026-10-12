-- Alertas y presupuestos de coste (ADR-086). Idempotente.

-- `alert:manage` crea, cambia y borra reglas y presupuestos. Es del perfil que mantiene el agente (technical); leer el estado
-- y el historial basta con `experiment:read`. org_admin no lee datos (ADR-052) y no lo tiene.
INSERT INTO role_permissions (role_name, permission) VALUES ('technical', 'alert:manage') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_rules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id     UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    metric            TEXT NOT NULL CHECK (metric IN ('error_rate', 'latency_p95', 'cost', 'satisfaction', 'custom')),
    -- la gráfica guardada de una regla `custom`. Si se borra, la regla queda sin métrica (se ve como inválida), no desaparece
    custom_metric_id  UUID REFERENCES custom_metrics(id) ON DELETE SET NULL,
    comparator        TEXT NOT NULL CHECK (comparator IN ('above', 'below')),
    threshold         DOUBLE PRECISION NOT NULL,
    window_minutes    INTEGER NOT NULL CHECK (window_minutes BETWEEN 5 AND 1440),
    min_samples       INTEGER NOT NULL DEFAULT 0 CHECK (min_samples BETWEEN 0 AND 100000),
    reminder_minutes  INTEGER CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 15 AND 10080),
    recipients        TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipients) <= 10),
    enabled           BOOLEAN NOT NULL DEFAULT true,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (metric = 'custom' OR custom_metric_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_experiment ON alert_rules (experiment_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled;

-- Estado actual de cada regla: una fila, la reescribe el evaluador en cada pasada
CREATE TABLE IF NOT EXISTS alert_states (
    rule_id          UUID PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
    state            TEXT NOT NULL CHECK (state IN ('ok', 'firing', 'no_data')),
    since            TIMESTAMPTZ NOT NULL,
    last_value       DOUBLE PRECISION,
    last_checked_at  TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alert_states_firing ON alert_states (rule_id) WHERE state = 'firing';

-- Historial: una fila por transición (disparada, resuelta, recordatorio). Se purga a los 90 días.
CREATE TABLE IF NOT EXISTS alert_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind          TEXT NOT NULL CHECK (kind IN ('fired', 'resolved', 'reminder')),
    value         DOUBLE PRECISION NOT NULL,
    threshold     DOUBLE PRECISION NOT NULL,
    -- a cuántas direcciones se envió; 0 si no había, si no hay proveedor de correo o si se alcanzó el tope diario
    emailed       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events (rule_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_experiment ON alert_events (experiment_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_at ON alert_events (at);

-- Un presupuesto mensual por experimento
CREATE TABLE IF NOT EXISTS cost_budgets (
    experiment_id UUID PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
    monthly_usd   NUMERIC(14, 2) NOT NULL CHECK (monthly_usd > 0),
    warn_percent  INTEGER NOT NULL DEFAULT 80 CHECK (warn_percent BETWEEN 1 AND 99),
    recipients    TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipients) <= 10),
    enabled       BOOLEAN NOT NULL DEFAULT true,
    updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avisos de presupuesto ya enviados: uno por experimento, mes y nivel
CREATE TABLE IF NOT EXISTS budget_notifications (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    month         DATE NOT NULL,
    level         TEXT NOT NULL CHECK (level IN ('warning', 'exceeded', 'forecast')),
    notified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    emailed       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (experiment_id, month, level)
);

-- Coste estimado por día, que el evaluador renueva para hoy y ayer. El gasto del mes sale de aquí y no de las trazas: con una
-- retención corta (ADR-084) los días anteriores ya no estarían, y la API no consulta rangos de más de 30 días.
CREATE TABLE IF NOT EXISTS experiment_daily_cost (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    day           DATE NOT NULL,
    cost_usd      DOUBLE PRECISION NOT NULL CHECK (cost_usd >= 0),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (experiment_id, day)
);
