-- Ejecuciones repetidas de un run para medir el ruido de la evaluación (ADR-097). Con `repeats=N` el SDK sube N `dataset_runs`
-- (una ejecución cada uno) que comparten `run_group_id` y se numeran 1..N en `repeat_index`; `repeat_total` guarda N para
-- saber si el grupo está completo. Un run sin repeticiones (`repeats=1`) deja las tres columnas en NULL: nada cambia para él.
-- Sin cambios en ClickHouse: cada ejecución tiene su propio DatasetRunId. Idempotente.
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS run_group_id UUID;
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS repeat_index INT;
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS repeat_total INT;
ALTER TABLE dataset_runs DROP CONSTRAINT IF EXISTS dataset_runs_run_group_check;
ALTER TABLE dataset_runs ADD CONSTRAINT dataset_runs_run_group_check CHECK (
    (run_group_id IS NULL AND repeat_index IS NULL AND repeat_total IS NULL)
    OR (run_group_id IS NOT NULL AND repeat_index IS NOT NULL AND repeat_total IS NOT NULL
        AND repeat_total BETWEEN 2 AND 10 AND repeat_index BETWEEN 1 AND repeat_total)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_runs_group_index ON dataset_runs(run_group_id, repeat_index) WHERE run_group_id IS NOT NULL;
