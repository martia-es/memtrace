-- Excepciones a las reglas de aprobación de la organización (ADR-076, ampliado): un `org_admin` puede dejar a UN experimento
-- (agente) fuera de la regla que la organización pone en un paso (publicar, o mover un entorno). El experimento sigue pudiendo
-- tener su propia regla en ese paso. Sin excepción, la organización pone el suelo y el experimento solo puede endurecerlo.
CREATE TABLE IF NOT EXISTS approval_rule_exemptions (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    action        TEXT NOT NULL CHECK (action IN ('publish', 'promote')),
    stage         TEXT NOT NULL DEFAULT '',
    granted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (experiment_id, action, stage),
    CHECK ((action = 'publish' AND stage = '') OR (action = 'promote' AND stage <> ''))
);
