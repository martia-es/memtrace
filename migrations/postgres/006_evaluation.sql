-- Datasets de evaluación offline (ADR-028, roadmap Fase 1.75). Datos curados a mano, poco
-- volumen, por eso viven aquí y no en ClickHouse. Los scores y el detalle por item de cada
-- ejecución sí viven en ClickHouse (ver migrations/clickhouse/005_scores.sql): esta tabla de
-- runs solo guarda metadatos (nombre, nº de items), y se crea únicamente si la escritura en
-- ClickHouse tuvo éxito (ver EvaluationService.submitDatasetRun), para no dejar huérfanos.

CREATE TABLE IF NOT EXISTS datasets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_datasets_experiment ON datasets(experiment_id);

CREATE TABLE IF NOT EXISTS dataset_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id      UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    input           JSONB NOT NULL,
    expected_output JSONB,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id);

CREATE TABLE IF NOT EXISTS dataset_runs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    item_count INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_runs_dataset ON dataset_runs(dataset_id);
