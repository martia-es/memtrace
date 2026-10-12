-- Corte limpio del modelo de resultados de evaluación (ADR-044): los items y scores de las runs viejas vivían
-- en la tabla ClickHouse `scores`, que la migración clickhouse/008 elimina sin migrar sus datos. Sus filas
-- aquí quedarían apuntando a items que ya no existen, así que se borran con ellos. Los datasets, sus
-- versiones y las colas de anotación de trazas no se tocan. Se ejecuta una sola vez (schema_migrations).
DELETE FROM annotation_queue_items WHERE target_type = 'run_item';
DELETE FROM dataset_runs;
