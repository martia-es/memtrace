-- Versionado de datasets (ADR-031, roadmap Fase 1.75). Hasta ahora `dataset_items` colgaba
-- directamente de `datasets` sin historial: editar un dataset mutaba los items que un run
-- pasado había usado, haciendo ese run irreproducible. `dataset_versions` es una tabla
-- intermedia inmutable: cada versión es una foto fija de items, y un `dataset_run` queda
-- fijado a la versión exacta que se ejecutó.

CREATE TABLE IF NOT EXISTS dataset_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id     UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    note           TEXT,
    created_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset ON dataset_versions(dataset_id);

-- backfill: cada dataset existente pasa a tener una versión 1 con sus items actuales
INSERT INTO dataset_versions (dataset_id, version_number, created_by, created_at)
SELECT id, 1, created_by, created_at FROM datasets
ON CONFLICT (dataset_id, version_number) DO NOTHING;

ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS dataset_version_id UUID REFERENCES dataset_versions(id) ON DELETE CASCADE;

UPDATE dataset_items di SET dataset_version_id = dv.id
  FROM dataset_versions dv
 WHERE dv.dataset_id = di.dataset_id AND dv.version_number = 1 AND di.dataset_version_id IS NULL;

ALTER TABLE dataset_items ALTER COLUMN dataset_version_id SET NOT NULL;
ALTER TABLE dataset_items DROP COLUMN IF EXISTS dataset_id;

CREATE INDEX IF NOT EXISTS idx_dataset_items_version ON dataset_items(dataset_version_id);

-- dataset_runs conserva dataset_id (permite filtrar runs por dataset sin join) y gana la
-- versión exacta contra la que se corrió.
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS dataset_version_id UUID REFERENCES dataset_versions(id) ON DELETE CASCADE;

UPDATE dataset_runs dr SET dataset_version_id = dv.id
  FROM dataset_versions dv
 WHERE dv.dataset_id = dr.dataset_id AND dv.version_number = 1 AND dr.dataset_version_id IS NULL;

ALTER TABLE dataset_runs ALTER COLUMN dataset_version_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dataset_runs_version ON dataset_runs(dataset_version_id);
