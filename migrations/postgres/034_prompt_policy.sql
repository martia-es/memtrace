-- Promoción de prompts con garantías (ADR-070). Un prompt puede tener una política: el dataset contra el que se evalúa y
-- cuántos runs seguidos deben pasar. Con política, mover el tag de un entorno protegido (todos menos el primero por
-- posición: dev) a una versión exige una evaluación offline exitosa de esa versión. Sin política, nada cambia.
-- Idempotente.

CREATE TABLE IF NOT EXISTS prompt_policies (
    prompt_id     UUID PRIMARY KEY REFERENCES prompts(id) ON DELETE CASCADE,
    -- si el dataset se borra la política queda incompleta y BLOQUEA las promociones (no se abre sola)
    dataset_id    UUID REFERENCES datasets(id) ON DELETE SET NULL,
    required_runs INT NOT NULL DEFAULT 1 CHECK (required_runs BETWEEN 1 AND 10),
    updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Qué dijo el gate cuando se movió el tag, y si alguien se lo saltó. Los movimientos anteriores a esta migración no pasaron
-- por ningún gate: quedan sin veredicto y sin salto, y volver a ellos sigue siendo un rollback válido.
ALTER TABLE prompt_tag_events ADD COLUMN IF NOT EXISTS gate_verdict TEXT;
ALTER TABLE prompt_tag_events ADD COLUMN IF NOT EXISTS gate_bypassed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE prompt_tag_events ADD COLUMN IF NOT EXISTS bypass_reason TEXT;
ALTER TABLE prompt_tag_events DROP CONSTRAINT IF EXISTS prompt_tag_events_bypass_reason;
ALTER TABLE prompt_tag_events ADD CONSTRAINT prompt_tag_events_bypass_reason
    CHECK (NOT gate_bypassed OR (bypass_reason IS NOT NULL AND length(btrim(bypass_reason)) > 0));
