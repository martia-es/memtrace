-- Fragmentos reutilizables (ADR-073). Un fragmento es un prompt de tipo `fragment` (texto compartido: tono, políticas, formato) que
-- otros prompts incluyen con `{{> nombre@tag}}` o `{{> nombre@3}}`. Al guardar una versión, cada inclusión se resuelve y se FIJA a
-- la versión exacta del fragmento: `content` es el texto ya resuelto (lo que sirve el SDK, lo que se evalúa y se mide, y de lo que
-- se calcula el hash), `source` lo que escribió quien lo editó e `includes` las versiones fijadas. La versión sigue siendo
-- inmutable y reproducible aunque el fragmento cambie después. Idempotente.

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'prompt';
ALTER TABLE prompts DROP CONSTRAINT IF EXISTS prompts_kind_check;
ALTER TABLE prompts ADD CONSTRAINT prompts_kind_check CHECK (kind IN ('prompt', 'fragment'));

-- NULL = la versión no incluye nada y `content` es lo que escribió quien la editó
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS includes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- para encontrar qué prompts usan un fragmento sin recorrer todas las versiones
CREATE INDEX IF NOT EXISTS idx_prompt_versions_includes ON prompt_versions USING gin (includes jsonb_path_ops) WHERE jsonb_array_length(includes) > 0;

CREATE OR REPLACE FUNCTION prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.includes IS DISTINCT FROM OLD.includes
       OR NEW.variables IS DISTINCT FROM OLD.variables
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.prompt_id IS DISTINCT FROM OLD.prompt_id THEN
        RAISE EXCEPTION 'prompt versions are immutable';
    END IF;
    IF OLD.status = 'published' AND NEW.status = 'draft' THEN
        RAISE EXCEPTION 'a published prompt version cannot go back to draft';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
