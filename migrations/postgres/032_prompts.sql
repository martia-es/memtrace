-- Registro de prompts (ADR-067): el prompt pertenece a la organización, se asocia a uno o varios agentes, cada guardado
-- crea una versión inmutable y los tags (dev/pre/pro u otros) son punteros móviles a una versión con su historial.
-- Idempotente.
--
-- Permisos: `prompt:read` (ver), `prompt:write` (crear prompts y versiones, mover tags libres) y `prompt:promote`
-- (mover los tags de entorno: dev/pre/pro). El gate de promoción (evaluación previa) llega en una fase posterior.

INSERT INTO role_permissions (role_name, permission) VALUES
    ('org_admin', 'prompt:read'),
    ('org_admin', 'prompt:write'),
    ('org_admin', 'prompt:promote'),
    ('technical', 'prompt:read'),
    ('technical', 'prompt:write'),
    ('technical', 'prompt:promote'),
    ('business',  'prompt:read'),
    ('governance', 'prompt:read')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    description     TEXT NOT NULL DEFAULT '',
    -- "eliminar" archiva: las versiones y su historial no se borran nunca
    archived_at     TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

-- Un prompt puede pertenecer a muchos agentes (experimentos). Que el experimento sea de la misma organización lo valida el repositorio.
CREATE TABLE IF NOT EXISTS prompt_agents (
    prompt_id     UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (prompt_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_agents_experiment ON prompt_agents(experiment_id);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id    UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    -- 1, 2, 3... por prompt
    version      INT NOT NULL CHECK (version >= 1),
    content      TEXT NOT NULL CHECK (length(btrim(content)) > 0),
    -- variables {{nombre}} detectadas al guardar
    variables    TEXT[] NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    -- versión de la que se partió al editar (NULL en la primera)
    parent_version INT,
    message      TEXT NOT NULL DEFAULT '',
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prompt_id, version)
);

-- Una versión es inmutable: lo guardado no se edita.
CREATE OR REPLACE FUNCTION prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.variables IS DISTINCT FROM OLD.variables
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.prompt_id IS DISTINCT FROM OLD.prompt_id THEN
        RAISE EXCEPTION 'prompt versions are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prompt_versions_immutable ON prompt_versions;
CREATE TRIGGER trg_prompt_versions_immutable BEFORE UPDATE ON prompt_versions
    FOR EACH ROW EXECUTE FUNCTION prompt_versions_immutable();

-- Tag actual -> versión. Los tags cuyo nombre es el de un entorno de la organización (dev/pre/pro...) son tags de entorno.
CREATE TABLE IF NOT EXISTS prompt_tags (
    prompt_id  UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL CHECK (tag ~ '^[a-z][a-z0-9_-]{0,31}$'),
    version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (prompt_id, tag)
);

-- Historial de movimientos de tags: quién lo movió, de qué versión a cuál y por qué. to_version NULL = el tag se quitó.
CREATE TABLE IF NOT EXISTS prompt_tag_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id    UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    tag          TEXT NOT NULL,
    from_version INT,
    to_version   INT,
    changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    reason       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_tag_events_prompt ON prompt_tag_events(prompt_id, created_at DESC);
