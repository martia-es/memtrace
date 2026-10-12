-- Catálogo de datos de las Custom charts (ADR-078): el nombre con el que cada experimento quiere ver un paso o un atributo
-- ("input_guardrail" -> "Filtro de datos personales") y si se enseña u oculta en los selectores. Solo se guardan las EDICIONES:
-- lo que existe en las trazas se descubre en vivo desde ClickHouse, así que no hay nada que sincronizar. La clave sigue siendo
-- la técnica (`memtrace.step_type`, clave de atributo), por eso renombrar nunca rompe una gráfica guardada. Idempotente.

-- `catalog:manage`: renombrar y ocultar en el catálogo. Los dos perfiles de trabajo conocen el negocio; al ser un permiso de un
-- rol-dato, una organización puede darlo o quitarlo sin tocar código (ADR-052).
INSERT INTO role_permissions (role_name, permission) VALUES
    ('technical', 'catalog:manage'),
    ('business',  'catalog:manage')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS chart_catalog_entries (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('step', 'attribute')),
    key           TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 300),
    -- NULL = sin nombre propio: se usa el del diccionario o el humanizado
    display_name  TEXT CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 80),
    -- `auto`: lo decide la clasificación; `shown` / `hidden` lo fuerzan una persona
    visibility    TEXT NOT NULL DEFAULT 'auto' CHECK (visibility IN ('auto', 'shown', 'hidden')),
    updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (experiment_id, kind, key),
    -- una fila que no dice nada no se guarda: volver a automático la borra
    CHECK (display_name IS NOT NULL OR visibility <> 'auto')
);
