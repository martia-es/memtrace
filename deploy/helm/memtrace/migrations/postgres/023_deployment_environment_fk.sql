-- Borrar una organización con asistentes desplegados fallaba: la FK de despliegue → entorno se comprobaba antes de que el
-- borrado en cascada (organización → experimentos → asistentes → despliegues) hubiera quitado los despliegues. Al diferir la
-- comprobación al final de la transacción, la cascada termina antes; sigue impidiendo borrar un entorno que aún tiene
-- despliegues. Idempotente.
ALTER TABLE assistant_deployments DROP CONSTRAINT IF EXISTS assistant_deployments_environment_id_fkey;
ALTER TABLE assistant_deployments ADD CONSTRAINT assistant_deployments_environment_id_fkey
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
