-- Retención de trazas por nivel de riesgo (ADR-102, amplía ADR-084): un plazo por nivel y organización, único sitio donde se
-- configura. Sustituye al plazo por organización y al override por experimento. Idempotente.
CREATE TABLE IF NOT EXISTS risk_policies (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    risk_level      TEXT NOT NULL CHECK (risk_level IN ('unclassified', 'minimal', 'limited', 'high')),
    retention_days  INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 365),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, risk_level),
    -- suelo del AI Act (art. 26.6): también aquí, para que ningún camino de escritura lo salte
    CONSTRAINT risk_policies_ai_act_floor CHECK (risk_level NOT IN ('high', 'unclassified') OR retention_days >= 180)
);

-- Una fila por nivel con el plazo que ya tenía la organización; `high` y `unclassified` no bajan del suelo.
INSERT INTO risk_policies (organization_id, risk_level, retention_days)
SELECT o.id, l.level, CASE WHEN l.level IN ('high', 'unclassified') THEN GREATEST(o.trace_retention_days, 180) ELSE o.trace_retention_days END
  FROM organizations o CROSS JOIN (VALUES ('unclassified'), ('minimal'), ('limited'), ('high')) AS l(level)
ON CONFLICT (organization_id, risk_level) DO NOTHING;

-- Los overrides por experimento desaparecen: el agente pasa a seguir su nivel y conserva las trazas más tiempo. Cada uno queda
-- en la auditoría con su valor anterior, para poder explicar el cambio.
INSERT INTO audit_log (organization_id, experiment_id, actor_user_id, actor_label, action, target_type, target_id, metadata)
SELECT e.organization_id, e.id, NULL, 'system:migration', 'retention.update', 'experiment', e.id::text,
       jsonb_build_object('droppedOverrideDays', e.trace_retention_days, 'reason', 'ADR-102: retention is set per risk level')
  FROM experiments e WHERE e.trace_retention_days IS NOT NULL;
UPDATE experiments SET trace_retention_days = NULL WHERE trace_retention_days IS NOT NULL;
-- `organizations.trace_retention_days` y `experiments.trace_retention_days` quedan sin uso una versión y se borran después.
