-- Decisiones sobre qué entrada de Arena es el mismo modelo que uno del catálogo de precios (ADR-025, ampliación). Idempotente.
-- Solo se guardan las decisiones de las personas; las coincidencias exactas se calculan al leer. Son de la organización:
-- el catálogo es global y público, pero decidir cambia lo que se ve, y una organización no debe poder cambiar lo de otra.
--   confirmed      esta entrada es el modelo (a lo sumo una por organización y clave)
--   rejected       esta entrada no lo es: no se vuelve a proponer
--   no_equivalent  Arena no lo publica (arena_model_name = ''): se deja de preguntar
CREATE TABLE IF NOT EXISTS model_quality_matches (
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    model_key        TEXT NOT NULL CHECK (length(model_key) BETWEEN 1 AND 200),
    arena_model_name TEXT NOT NULL DEFAULT '' CHECK (length(arena_model_name) <= 300),
    decision         TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'no_equivalent')),
    decided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, model_key, arena_model_name),
    CHECK ((decision = 'no_equivalent') = (arena_model_name = ''))
);
-- como mucho una decisión «positiva» (confirmada o sin equivalente) por clave
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_quality_matches_one_answer
    ON model_quality_matches (organization_id, model_key) WHERE decision IN ('confirmed', 'no_equivalent');

-- `pricing:manage` decide las coincidencias. Es de technical, como `alert:manage`: quien mantiene el agente conoce sus modelos y
-- ve en sus trazas cuáles usa. org_admin no lee datos (ADR-052) y no lo tiene.
INSERT INTO role_permissions (role_name, permission) VALUES ('technical', 'pricing:manage') ON CONFLICT DO NOTHING;
