-- Borradores de prompt (ADR-072). Una propuesta de arreglo —escrita a mano o por una herramienta con un LLM— se guarda como
-- versión en estado `draft`: tiene número (se puede probar en el playground y evaluar con el agente, que la pide por número),
-- pero no puede recibir un tag y nunca se promueve sola. Una persona la revisa y la publica, o la descarta.
-- `origin` recuerda de dónde viene: el fallo que se quería arreglar. Idempotente.

ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_status_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_status_check CHECK (status IN ('draft', 'published'));
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS origin JSONB;
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE prompt_versions SET published_at = created_at WHERE status = 'published' AND published_at IS NULL;

-- Un número de versión no se reutiliza jamás: un borrador descartado pudo probarse en el playground o evaluarse, y sus trazas,
-- tokens y resultados llevan ese número. `last_version` es el contador por prompt; antes de los borradores coincidía con MAX(version).
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS last_version INT NOT NULL DEFAULT 0;
UPDATE prompts p SET last_version = COALESCE((SELECT MAX(v.version) FROM prompt_versions v WHERE v.prompt_id = p.id), 0) WHERE p.last_version = 0;

-- Una versión sigue siendo inmutable (texto, variables, hash, número); lo único que cambia es borrador -> publicada, y nunca al revés.
CREATE OR REPLACE FUNCTION prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content
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
