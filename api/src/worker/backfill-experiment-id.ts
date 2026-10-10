/**
 * Backfill de ExperimentId (ADR-077): asigna el experimento a las filas anteriores a la migración 013 de ClickHouse.
 * Una pasada, idempotente, pensada para un Job de Kubernetes (o `make backfill-experiment-id`). Necesita un usuario de
 * ClickHouse con ALTER/INSERT/SELECT (el `default` del clúster local), no el de solo lectura de la API.
 */
import { createClient } from "@clickhouse/client";
import { ExperimentIdBackfill, planBackfill } from "@/adapters/outbound/clickhouse/experiment-id-backfill";
import { configFromEnv as clickhouseConfigFromEnv } from "@/adapters/outbound/clickhouse/client";
import { configFromEnv, createPool } from "@/adapters/outbound/postgres/client";

async function main() {
  const pool = createPool(configFromEnv());
  const config = clickhouseConfigFromEnv();
  const client = createClient({ url: config.url, username: config.username, password: config.password, database: config.database, request_timeout: 600_000 });
  try {
    const { rows } = await pool.query<{ id: string; service_name: string }>(`SELECT id, service_name FROM experiments`);
    const plan = planBackfill(rows.map((r) => ({ id: r.id, serviceName: r.service_name })));
    const backfill = new ExperimentIdBackfill(client, config.database);
    const counts = await backfill.run(plan.assign);
    for (const c of counts) console.log(`[backfill] ${c.table}: ${c.rows} rows of "${c.serviceName}" assigned`);
    for (const a of plan.ambiguous) {
      console.warn(`[backfill] service "${a.serviceName}" belongs to ${a.experimentIds.length} experiments (${a.experimentIds.join(", ")}): its earlier rows stay unassigned and invisible. Decide who owns them.`);
    }
    const left = await backfill.unassigned();
    for (const l of left) console.warn(`[backfill] still unassigned: ${l.table} / "${l.serviceName}": ${l.rows} rows`);
    console.log(`[backfill] done: ${counts.length} table/service pairs updated, ${plan.ambiguous.length} ambiguous services, ${left.length} unassigned groups`);
  } finally {
    await client.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[backfill] failed:", error);
  process.exit(1);
});
