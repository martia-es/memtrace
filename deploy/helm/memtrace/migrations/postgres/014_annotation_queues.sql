-- Colas de anotación (ADR-039): qué hay que revisar, con qué rúbrica y quién lo ha cogido.
-- Las etiquetas en sí viven en ClickHouse (`annotations`, ADR-037); aquí solo el estado del flujo de trabajo.

CREATE TABLE IF NOT EXISTS annotation_queues (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id        UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    instructions         TEXT,                          -- guía que se muestra encima de la rúbrica
    required_annotations INT  NOT NULL DEFAULT 1 CHECK (required_annotations BETWEEN 1 AND 10),
    created_by           UUID NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at          TIMESTAMPTZ
);

-- Un nombre solo es único entre colas no archivadas (igual que score_configs).
CREATE UNIQUE INDEX IF NOT EXISTS annotation_queues_name_idx
    ON annotation_queues (experiment_id, name) WHERE archived_at IS NULL;

-- La rúbrica de la cola: un subconjunto ordenado de score_configs.
CREATE TABLE IF NOT EXISTS annotation_queue_configs (
    queue_id  UUID NOT NULL REFERENCES annotation_queues(id) ON DELETE CASCADE,
    config_id UUID NOT NULL REFERENCES score_configs(id),
    required  BOOLEAN NOT NULL DEFAULT true,
    position  INT NOT NULL,
    PRIMARY KEY (queue_id, config_id)
);

-- Qué hay que revisar: solo ids, nunca el contenido de la traza.
-- `status` es una caché de lo que dicen los claims (completed = claims completados >= required_annotations);
-- solo `skipped` lo fija un admin a mano ("marcar como no revisable").
CREATE TABLE IF NOT EXISTS annotation_queue_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id       UUID NOT NULL REFERENCES annotation_queues(id) ON DELETE CASCADE,
    target_type    TEXT NOT NULL CHECK (target_type IN ('trace', 'run_item')),
    trace_id       TEXT NOT NULL DEFAULT '',
    dataset_run_id UUID,
    item_index     INT,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
    added_by       UUID NOT NULL REFERENCES users(id),
    added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    -- dataset_run_id / item_index son NULL en las trazas: NULLS NOT DISTINCT (PostgreSQL 15+) los trata como iguales.
    UNIQUE NULLS NOT DISTINCT (queue_id, target_type, trace_id, dataset_run_id, item_index)
);

CREATE INDEX IF NOT EXISTS annotation_queue_items_pending_idx
    ON annotation_queue_items (queue_id, status, added_at);

-- Una fila por revisor y item: con required_annotations > 1 un item tiene varios revisores.
CREATE TABLE IF NOT EXISTS annotation_queue_claims (
    queue_item_id UUID NOT NULL REFERENCES annotation_queue_items(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id),
    claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    skipped_at    TIMESTAMPTZ,
    PRIMARY KEY (queue_item_id, user_id)
);
