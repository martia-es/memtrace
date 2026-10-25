-- Reglas de alerta de seguridad y de calidad en evaluaciones (ADR-086, actualización 2026-10-25). Idempotente.
--
-- `params` guarda lo propio de cada tipo de regla sin una columna por campo:
--   security_detections / security_blocked: {"detector": "secret_leak"|null, "severity": "..."|null}
--   eval_score:  {"target": "redteam/" o nombre de dataset, "score": "" (cualquier check) o nombre del score, "mode": "absolute"|"drop"}
--   eval_stale:  {"target": ...}
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_metric_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_metric_check
    CHECK (metric IN ('error_rate', 'latency_p95', 'cost', 'satisfaction', 'custom', 'security_detections', 'security_blocked', 'eval_score', 'eval_stale'));
