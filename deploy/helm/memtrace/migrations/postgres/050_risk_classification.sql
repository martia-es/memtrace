-- Clasificación de riesgo del agente (ADR-102). Vive en el experimento, como el resto de la ficha (ADR-054).
-- `risk_level` NULL = sin clasificar: es un estado propio, distinto de `minimal`. Idempotente.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS intended_purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS known_limitations TEXT NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS risk_classified_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS risk_classified_at TIMESTAMPTZ;
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_risk_level_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_risk_level_check CHECK (risk_level IS NULL OR risk_level IN ('minimal', 'limited', 'high'));
