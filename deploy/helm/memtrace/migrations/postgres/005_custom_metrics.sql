-- Gráficos custom definidos por el usuario sobre spans propios (ADR-027). La definición (tipo de
-- gráfico, step types, métrica, filtros, agrupación) es JSON de forma libre: la valida la API con
-- zod al guardar, no PostgreSQL. Los datos que grafican viven en ClickHouse, no aquí.

CREATE TABLE IF NOT EXISTS custom_metrics (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    definition    JSONB NOT NULL,
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_metrics_experiment ON custom_metrics(experiment_id);
