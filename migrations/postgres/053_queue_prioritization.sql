-- Orden de reparto de las colas de anotación (ADR-039, ampliado): `fifo` (por defecto, el comportamiento de siempre)
-- o `uncertainty`: primero los items cuyo resultado es más dudoso (valor del episodio de Mem cerca de la zona
-- «suspect», o señales que se contradicen). La prioridad se calcula al añadir el item y se guarda aquí: así el reparto
-- (`FOR UPDATE SKIP LOCKED`) sigue siendo una sola consulta en Postgres, sin ir a ClickHouse en cada `next`.
-- NULL = sin episodio todavía (o no es una traza): va detrás de los que tienen prioridad, en orden de llegada.
ALTER TABLE annotation_queues
    ADD COLUMN IF NOT EXISTS prioritization TEXT NOT NULL DEFAULT 'fifo'
        CHECK (prioritization IN ('fifo', 'uncertainty'));

ALTER TABLE annotation_queue_items
    ADD COLUMN IF NOT EXISTS priority REAL
        CHECK (priority IS NULL OR (priority >= 0 AND priority <= 1));
