-- El gasto del mes cuando se envió cada aviso de presupuesto, para que la campana diga «Has gastado $41 de tus $50» (ADR-094).
-- Idempotente. Los avisos anteriores se quedan sin cifra (NULL) y la campana usa una frase sin ella.
ALTER TABLE budget_notifications ADD COLUMN IF NOT EXISTS spent_usd DOUBLE PRECISION;
