/**
 * Worker de retención (ADR-084): una pasada por ejecución, pensada para un CronJob diario de Kubernetes.
 * Borra, por experimento, las trazas anteriores a su plazo, y purga el registro de auditoría más antiguo que su propia retención.
 * Raíz de composición propia: usa el usuario de ClickHouse `retention_worker`, que solo puede leer y borrar en las tablas de trazas.
 */
import { createRetentionClient, configFromEnv as clickhouseConfigFromEnv } from "@/adapters/outbound/clickhouse/client";
import { ClickHouseTracePurger } from "@/adapters/outbound/clickhouse/clickhouse-trace-purger";
import { configFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { PostgresRetentionRepository } from "@/adapters/outbound/postgres/postgres-retention-repository";
import { AuditService } from "@/application/audit-service";
import { RetentionService } from "@/application/retention-service";
import { AUDIT_RETENTION_DAYS } from "@/domain/audit";
import { retentionCutoff } from "@/domain/retention";

async function main() {
  const pool = createPool(configFromEnv());
  const clickhouse = clickhouseConfigFromEnv();
  const client = createRetentionClient(clickhouse);
  try {
    const audit = new AuditService(new PostgresAuditRepository(pool));
    const retention = new RetentionService(new PostgresRetentionRepository(pool), audit, new ClickHouseTracePurger(client, clickhouse.database));
    const started = Date.now();
    const summary = await retention.purgeExpired();
    console.log(`[retention] experiments=${summary.experiments} spans=${summary.spans} failed=${summary.failed} in ${Date.now() - started} ms`);

    const purgedAudit = await audit.purgeOlderThan(retentionCutoff(new Date(), AUDIT_RETENTION_DAYS));
    console.log(`[retention] audit entries purged=${purgedAudit}`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await client.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[retention] failed:", error);
  process.exit(1);
});
