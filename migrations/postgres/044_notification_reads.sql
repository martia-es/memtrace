-- Hasta dónde ha leído cada persona sus notificaciones de la campana (ADR-094). Idempotente.
-- Las notificaciones no tienen tabla propia: salen de alert_events y budget_notifications. Lo único que es de cada persona
-- es esta marca, así que «marcar todo como leído» es una fila, no una fila por aviso.
CREATE TABLE IF NOT EXISTS notification_reads (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL
);
