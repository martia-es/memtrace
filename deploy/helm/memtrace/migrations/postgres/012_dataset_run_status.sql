-- Estado de un dataset_run (ADR-034): el SDK sube los items por lotes mientras corre el experimento,
-- así que un run puede estar `running` (aún recibe items, o el proceso murió a medias) o `completed`.
-- Los runs previos se subieron de una sola vez, por tanto ya están completos.
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE dataset_runs DROP CONSTRAINT IF EXISTS dataset_runs_status_check;
ALTER TABLE dataset_runs ADD CONSTRAINT dataset_runs_status_check CHECK (status IN ('running', 'completed'));
