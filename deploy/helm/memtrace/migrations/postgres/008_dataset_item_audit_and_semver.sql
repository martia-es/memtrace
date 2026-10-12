-- Reemplaza el versionado manual de ADR-031 por versionado automático semver + auditoría por
-- item (ADR-032): cada alta/edición/borrado de item crea su propia versión sin intervención del
-- usuario (añadir/borrar = bump major, editar = bump minor), y cada item lleva quién lo creó y
-- quién lo editó por última vez.

ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS major INT;
ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS minor INT;

UPDATE dataset_versions SET major = version_number, minor = 0 WHERE major IS NULL;

ALTER TABLE dataset_versions ALTER COLUMN major SET NOT NULL;
ALTER TABLE dataset_versions ALTER COLUMN minor SET NOT NULL;
ALTER TABLE dataset_versions DROP CONSTRAINT IF EXISTS dataset_versions_dataset_id_version_number_key;
ALTER TABLE dataset_versions DROP COLUMN IF EXISTS version_number;
ALTER TABLE dataset_versions ADD CONSTRAINT dataset_versions_dataset_id_major_minor_key UNIQUE (dataset_id, major, minor);

ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- backfill: no se conoce el autor original de items ya existentes, se atribuyen a quien creó la
-- versión en la que viven (lo más fiel que se puede reconstruir retroactivamente).
UPDATE dataset_items di SET created_by = dv.created_by
  FROM dataset_versions dv WHERE dv.id = di.dataset_version_id AND di.created_by IS NULL;

ALTER TABLE dataset_items ALTER COLUMN created_by SET NOT NULL;
