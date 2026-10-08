-- Qué versión de cada prompt está usando de verdad cada agente en cada entorno (ADR-068). La informa el SDK con un
-- latido ligero en segundo plano; así la pantalla muestra la versión realmente en uso, no solo a qué apunta el tag.
-- Una fila por (prompt, agente, entorno, tag que sigue, versión): mientras las réplicas de un agente se actualizan puede
-- haber dos versiones a la vez, y se ve. `tag` vacío = el agente pidió una versión fija. `environment` vacío = el
-- agente no declara entorno (MEMTRACE_ENVIRONMENT). Idempotente.

CREATE TABLE IF NOT EXISTS prompt_usage (
    prompt_id     UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    environment   TEXT NOT NULL DEFAULT '' CHECK (environment = '' OR environment ~ '^[a-z][a-z0-9_-]{0,31}$'),
    tag           TEXT NOT NULL DEFAULT '' CHECK (tag = '' OR tag ~ '^[a-z][a-z0-9_-]{0,31}$'),
    version       INT NOT NULL CHECK (version >= 1),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (prompt_id, experiment_id, environment, tag, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_usage_seen ON prompt_usage(prompt_id, last_seen_at DESC);
