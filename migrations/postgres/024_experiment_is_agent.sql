-- Un experimento ES un agente (ADR-054): la ficha del asistente pasa a vivir en la propia fila del experimento y la tabla
-- `assistants` (ADR-053) desaparece. Así no hay experimentos «sin registrar»: el catálogo es la lista de experimentos.
-- Idempotente: se puede relanzar sin duplicar ni perder nada.

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS description   TEXT NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS team          TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS lifecycle     TEXT NOT NULL DEFAULT 'active';
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_lifecycle_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_lifecycle_check CHECK (lifecycle IN ('active', 'retired'));

DO $$
BEGIN
    IF to_regclass('public.assistants') IS NOT NULL THEN
        -- lo que ya se hubiera registrado pasa al experimento
        UPDATE experiments e
           SET description = a.description, owner_user_id = a.owner_user_id, team = a.team, lifecycle = a.lifecycle
          FROM assistants a
         WHERE a.experiment_id = e.id;
        -- las claves foráneas apuntaban a `assistants`: se sueltan para poder borrarla y se recrean abajo contra `experiments`
        ALTER TABLE assistant_deployments DROP CONSTRAINT IF EXISTS assistant_deployments_experiment_id_fkey;
        ALTER TABLE assistant_connections DROP CONSTRAINT IF EXISTS assistant_connections_experiment_id_fkey;
        ALTER TABLE assistant_connections DROP CONSTRAINT IF EXISTS assistant_connections_peer_experiment_id_fkey;
        DROP TABLE assistants;
    END IF;
END $$;

-- Quien creó el experimento entró como `technical` (el primero por fecha): es su dueño hasta que se cambie.
UPDATE experiments e
   SET owner_user_id = (SELECT m.user_id FROM experiment_memberships m
                         WHERE m.experiment_id = e.id AND m.role = 'technical' ORDER BY m.created_at, m.user_id LIMIT 1)
 WHERE e.owner_user_id IS NULL;

ALTER TABLE assistant_deployments DROP CONSTRAINT IF EXISTS assistant_deployments_experiment_id_fkey;
ALTER TABLE assistant_deployments ADD CONSTRAINT assistant_deployments_experiment_id_fkey
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
ALTER TABLE assistant_connections DROP CONSTRAINT IF EXISTS assistant_connections_experiment_id_fkey;
ALTER TABLE assistant_connections ADD CONSTRAINT assistant_connections_experiment_id_fkey
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
ALTER TABLE assistant_connections DROP CONSTRAINT IF EXISTS assistant_connections_peer_experiment_id_fkey;
ALTER TABLE assistant_connections ADD CONSTRAINT assistant_connections_peer_experiment_id_fkey
    FOREIGN KEY (peer_experiment_id) REFERENCES experiments(id) ON DELETE SET NULL;
