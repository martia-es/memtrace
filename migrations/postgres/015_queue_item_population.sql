-- Cómo llegó cada item a la cola (ADR-039, enmienda de ADR-040): el acuerdo juez-humano solo es
-- representativo si la muestra etiquetada lo es, así que la cola recuerda si un item se eligió a mano,
-- por un filtro/run completo o por muestreo aleatorio (y con qué semilla, para poder reproducirlo).
-- Los items anteriores a esta migración se consideran manuales.
ALTER TABLE annotation_queue_items
    ADD COLUMN IF NOT EXISTS population  TEXT NOT NULL DEFAULT 'manual'
        CHECK (population IN ('manual', 'filter', 'random_sample')),
    ADD COLUMN IF NOT EXISTS sample_seed TEXT;
