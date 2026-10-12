-- Gate de evaluación en el PR (ADR-064, fase 3): si está activo, MemTrace publica en GitHub un check run por el commit evaluado
-- (`memtrace/eval-gate`) para que una regla de rama impida fusionar un PR cuya evaluación no pasa. Opt-in por agente. Idempotente.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS pr_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE;
