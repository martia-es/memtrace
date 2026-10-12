-- Score configs (ADR-036): rúbricas por experimento que declaran qué se puntúa y cómo.
-- Las anotaciones humanas (ADR-037) referenciarán `id`; el tipo es inmutable tras la creación.

CREATE TABLE IF NOT EXISTS score_configs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    data_type     TEXT NOT NULL CHECK (data_type IN ('numeric', 'boolean', 'categorical')),
    min_value     DOUBLE PRECISION,           -- solo numeric
    max_value     DOUBLE PRECISION,           -- solo numeric
    categories    JSONB,                       -- solo categorical: [{ "label": "formal", "value": 0 }, ...]
    description   TEXT,                        -- guía que ve quien anota
    created_by    UUID NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at   TIMESTAMPTZ,
    CONSTRAINT score_configs_shape CHECK (
        (data_type = 'numeric'
            AND min_value IS NOT NULL AND max_value IS NOT NULL AND min_value < max_value
            AND categories IS NULL)
        OR (data_type = 'boolean'
            AND min_value IS NULL AND max_value IS NULL AND categories IS NULL)
        OR (data_type = 'categorical'
            AND min_value IS NULL AND max_value IS NULL
            AND categories IS NOT NULL AND jsonb_typeof(categories) = 'array' AND jsonb_array_length(categories) >= 2)
    )
);

-- Un nombre solo es único entre configs no archivadas: un nombre archivado puede reutilizarse.
CREATE UNIQUE INDEX IF NOT EXISTS score_configs_name_active_idx
    ON score_configs (experiment_id, name) WHERE archived_at IS NULL;
