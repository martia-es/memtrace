-- Cada versión de un dataset clona sus items con filas nuevas, así que un mismo item lógico tenía
-- un `id` distinto en cada versión y no se podía saber qué había cambiado entre dos versiones.
-- `origin_item_id` es la identidad estable del item: el `id` de la fila con la que nació, copiado
-- tal cual en cada clon (ADR-033). El diff entre versiones se calcula emparejando por esta columna.
--
-- Backfill (best-effort) para filas anteriores a esta migración: un clon conserva `created_by` y
-- `created_at` de su original, así que se empareja por (dataset, created_by, created_at). Los items
-- de un mismo lote comparten `created_at` (now() es el de la transacción); dentro de cada lote se
-- desempata por posición según `input::text`, lo que puede emparejar mal un item de lote cuyo input
-- se editó después. Los datasets creados a partir de ahora no dependen de esta heurística.

ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS origin_item_id UUID;

WITH ranked AS (
  SELECT i.id, v.dataset_id, v.major, v.minor, i.created_by, i.created_at,
         row_number() OVER (PARTITION BY i.dataset_version_id, i.created_by, i.created_at ORDER BY i.input::text, i.id) AS pos
    FROM dataset_items i
    JOIN dataset_versions v ON v.id = i.dataset_version_id
),
origins AS (
  SELECT DISTINCT ON (dataset_id, created_by, created_at, pos) id, dataset_id, created_by, created_at, pos
    FROM ranked
   ORDER BY dataset_id, created_by, created_at, pos, major, minor
)
UPDATE dataset_items i
   SET origin_item_id = o.id
  FROM ranked r
  JOIN origins o ON o.dataset_id = r.dataset_id AND o.created_by = r.created_by AND o.created_at = r.created_at AND o.pos = r.pos
 WHERE i.id = r.id;

UPDATE dataset_items SET origin_item_id = id WHERE origin_item_id IS NULL;

ALTER TABLE dataset_items ALTER COLUMN origin_item_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS dataset_items_origin_idx ON dataset_items (origin_item_id);
