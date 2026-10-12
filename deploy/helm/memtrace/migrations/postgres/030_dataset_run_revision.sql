-- Commit del código que se evaluó (ADR-065). Lo manda el SDK al abrir el run; el gate de despliegue (ADR-064) exige un
-- run completado del mismo commit. `revision_dirty` = el árbol tenía cambios sin commitear (true), no los tenía (false)
-- o no se sabe (NULL: el commit vino del CI, que siempre parte de un checkout limpio). NULL en `revision` = versión
-- desconocida. Idempotente.
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS revision TEXT;
ALTER TABLE dataset_runs ADD COLUMN IF NOT EXISTS revision_dirty BOOLEAN;
ALTER TABLE dataset_runs DROP CONSTRAINT IF EXISTS dataset_runs_revision_check;
ALTER TABLE dataset_runs ADD CONSTRAINT dataset_runs_revision_check CHECK (revision IS NULL OR revision ~ '^[0-9a-f]{7,64}$');
CREATE INDEX IF NOT EXISTS idx_dataset_runs_revision ON dataset_runs(revision) WHERE revision IS NOT NULL;
