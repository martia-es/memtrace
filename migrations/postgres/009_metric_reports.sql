-- Informes guardados por experimento: agrupan varias custom_metrics con un layout de grid libre
-- (ADR-035). No duplican la definición del gráfico — solo referencian custom_metrics y dicen dónde
-- y con qué tamaño aparece cada uno.

CREATE TABLE IF NOT EXISTS metric_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metric_reports_experiment ON metric_reports(experiment_id);

-- Grid de 12 columnas, igual convención que Grafana/Bootstrap. `custom_metric_id` apunta a un
-- gráfico ya guardado (ADR-027): editar el gráfico se refleja en todos los informes que lo usan.
CREATE TABLE IF NOT EXISTS metric_report_charts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id        UUID NOT NULL REFERENCES metric_reports(id) ON DELETE CASCADE,
    custom_metric_id UUID NOT NULL REFERENCES custom_metrics(id) ON DELETE CASCADE,
    grid_x           SMALLINT NOT NULL DEFAULT 0,
    grid_y           SMALLINT NOT NULL DEFAULT 0,
    grid_w           SMALLINT NOT NULL DEFAULT 6,
    grid_h           SMALLINT NOT NULL DEFAULT 4,
    UNIQUE (report_id, custom_metric_id)
);

CREATE INDEX IF NOT EXISTS idx_metric_report_charts_report ON metric_report_charts(report_id);
