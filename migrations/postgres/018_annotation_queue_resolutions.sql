-- Decisión del perfil técnico sobre un criterio de un item de cola (ADR-050). Las etiquetas de los revisores
-- siguen en ClickHouse y no se tocan: esto es una capa aparte, atribuida a quien resuelve.
CREATE TABLE IF NOT EXISTS annotation_queue_resolutions (
    queue_item_id   UUID NOT NULL REFERENCES annotation_queue_items(id) ON DELETE CASCADE,
    config_id       UUID NOT NULL REFERENCES score_configs(id),
    value           TEXT NOT NULL,
    expected_output TEXT,
    resolved_by     UUID NOT NULL REFERENCES users(id),
    resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (queue_item_id, config_id)
);
