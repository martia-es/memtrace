-- `team` (ADR-054) era un texto libre que no agrupaba a nadie ni daba permisos. Quien forma parte de un agente son los
-- miembros de su experimento, elegidos a mano (técnicos y negocio). Idempotente.
ALTER TABLE experiments DROP COLUMN IF EXISTS team;
