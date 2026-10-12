-- Objetivo de pass rate por score config (ADR-060): el dashboard de evaluaciones lo usa en vez de un 80% fijo.
-- NULL = sin objetivo propio (se aplica el valor por defecto del dashboard). Solo tiene sentido en configs boolean.
ALTER TABLE score_configs
    ADD COLUMN IF NOT EXISTS target_pass_rate DOUBLE PRECISION
        CHECK (target_pass_rate IS NULL OR (target_pass_rate > 0 AND target_pass_rate <= 1));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_configs_target_boolean_only') THEN
        ALTER TABLE score_configs
            ADD CONSTRAINT score_configs_target_boolean_only CHECK (target_pass_rate IS NULL OR data_type = 'boolean');
    END IF;
END $$;
