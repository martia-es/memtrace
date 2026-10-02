-- Hasta ahora borrar un item de un dataset lo excluía sin más del clonado a la siguiente
-- versión: no quedaba registro de qué item era, quién lo borró ni cuándo (ADR-032 prometía
-- auditoría completa por item, y el borrado se quedó corto). Esta migración añade un tombstone:
-- al borrar, el item se clona a la nueva versión con `deleted_by`/`deleted_at` en vez de
-- desaparecer, preservando su contenido y autoría original. La vista de "items actuales" sigue
-- filtrando por `deleted_at IS NULL`; el tombstone solo vive en la versión donde se borró (no se
-- vuelve a clonar hacia adelante), consultable desde el historial de versiones.

ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
