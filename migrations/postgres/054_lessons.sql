-- Lecciones de Mem (Fase 2.2, ADR-104): lo que una persona decide sobre lo que el agente debe aprender de sus fallos.
-- Es la fuente de verdad curada; lo que se calcula de las trazas (episodios, hallazgos) vive en ClickHouse. Idempotente.
--
-- Permisos, con la lógica de `prompt:read|write|promote`:
--   lesson:read    ver las lecciones de un agente
--   lesson:review  proponer una lección, editarla (versión nueva), marcarla revisada, devolverla o descartarla
--   lesson:approve aprobarla, activarla en un entorno, retirarla o declararla obsoleta
-- `business` revisa pero no aprueba: sabe si la lección es verdad, pero poner una instrucción en el agente es decisión técnica.

INSERT INTO role_permissions (role_name, permission) VALUES
    ('org_admin',  'lesson:read'),
    ('org_admin',  'lesson:review'),
    ('org_admin',  'lesson:approve'),
    ('technical',  'lesson:read'),
    ('technical',  'lesson:review'),
    ('technical',  'lesson:approve'),
    ('business',   'lesson:read'),
    ('business',   'lesson:review'),
    ('governance', 'lesson:read')
ON CONFLICT DO NOTHING;

-- Una lección pertenece a UN agente (experimento): una consultora no aprende de un cliente para aplicarlo a otro (ADR-091).
CREATE TABLE IF NOT EXISTS lessons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'reviewed', 'approved', 'obsolete', 'retired', 'dismissed')),
    -- quién la originó: el worker de Mem a partir de un hallazgo, o una persona
    source          TEXT NOT NULL CHECK (source IN ('mem', 'manual')),
    -- identidad estable del hallazgo que la originó (hash de causa y regla). Una descartada sigue ocupando su huella, así que
    -- Mem no vuelve a proponerla. NULL en las manuales.
    fingerprint     TEXT,
    -- última versión; el texto vigente es el de esa versión
    current_version INT NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    -- lo medido cuando se propuso (soporte, fallos, valor p, regla): contexto, no contenido de usuario
    origin_metrics  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((source = 'mem') = (fingerprint IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lessons_fingerprint ON lessons (experiment_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_experiment_status ON lessons (experiment_id, status);

-- Cada edición del texto es una versión nueva e inmutable: la traza sella `lesson id + versión` y el efecto se mide por versión.
CREATE TABLE IF NOT EXISTS lesson_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id    UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    version      INT NOT NULL CHECK (version >= 1),
    title        TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    -- cuándo aplica y qué falla (contexto para quien revisa); NO se inyecta en el agente
    situation    TEXT NOT NULL DEFAULT '',
    failure      TEXT NOT NULL DEFAULT '',
    -- lo ÚNICO que llega al agente: acotado, porque se inyecta en cada petición
    guidance     TEXT NOT NULL CHECK (length(btrim(guidance)) > 0),
    -- cuándo se dispara, de forma determinista (sin embeddings en la petición): herramientas, categorías de error o intenciones
    match        JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash TEXT NOT NULL,
    origin       TEXT NOT NULL CHECK (origin IN ('mem', 'human')),
    message      TEXT NOT NULL DEFAULT '',
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (lesson_id, version)
);

CREATE OR REPLACE FUNCTION lesson_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.situation IS DISTINCT FROM OLD.situation
       OR NEW.failure IS DISTINCT FROM OLD.failure
       OR NEW.guidance IS DISTINCT FROM OLD.guidance
       OR NEW.match IS DISTINCT FROM OLD.match
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id THEN
        RAISE EXCEPTION 'lesson versions are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lesson_versions_immutable ON lesson_versions;
CREATE TRIGGER trg_lesson_versions_immutable BEFORE UPDATE ON lesson_versions
    FOR EACH ROW EXECUTE FUNCTION lesson_versions_immutable();

-- Evidencia: solo ids de traza (nunca su contenido). Pueden quedar colgando cuando caduque la retención de la traza (ADR-084).
CREATE TABLE IF NOT EXISTS lesson_evidence (
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    trace_id  TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('failure', 'success')),
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lesson_id, trace_id)
);

-- En qué entornos está activa. Solo una lección aprobada puede estarlo; el repositorio las quita al salir de `approved` o al
-- cambiar el texto, para que una versión sin aprobar nunca llegue al agente.
CREATE TABLE IF NOT EXISTS lesson_activations (
    lesson_id    UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    environment  TEXT NOT NULL CHECK (environment ~ '^[a-z][a-z0-9_-]{0,31}$'),
    -- la versión aprobada que se sirve: el texto sellado en la traza
    version      INT NOT NULL CHECK (version >= 1),
    activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lesson_id, environment)
);

-- Historial append-only: quién hizo qué y cuándo. actor NULL = el sistema (el worker de Mem).
CREATE TABLE IF NOT EXISTS lesson_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id   UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('created', 'version', 'transition', 'activate', 'deactivate')),
    from_status TEXT,
    to_status   TEXT,
    version     INT,
    environment TEXT,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_label TEXT NOT NULL DEFAULT '',
    comment     TEXT NOT NULL DEFAULT '',
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_events_lesson ON lesson_events (lesson_id, at DESC);
