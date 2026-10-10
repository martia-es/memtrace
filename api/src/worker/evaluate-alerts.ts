/**
 * Worker de alertas y presupuestos (ADR-086): una pasada por ejecución, pensada para un CronJob de Kubernetes cada cinco minutos.
 * Mide cada regla con lo que ya calcula el dashboard, aplica la máquina de estados, avisa por email y renueva el coste diario de los
 * presupuestos. Raíz de composición propia, como `probe-health.ts`. También purga el historial de alertas de más de 90 días.
 */
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseUserFeedbackRepository } from "@/adapters/outbound/clickhouse/clickhouse-user-feedback-repository";
import { configFromEnv as clickhouseConfigFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { NoopEmailSender, ResendEmailSender } from "@/adapters/outbound/email/resend-email-sender";
import { PostgresAlertRepository } from "@/adapters/outbound/postgres/postgres-alert-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { configFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import { AlertEvaluator } from "@/application/alert-evaluator";
import { TraceAlertMetricSource } from "@/application/alert-metric-source";
import { TraceQueryService } from "@/application/trace-query-service";

const EVENT_RETENTION_DAYS = 90;

async function main() {
  const pool = createPool(configFromEnv());
  try {
    const clickhouse = clickhouseConfigFromEnv();
    const read = createReadOnlyClient(clickhouse);
    const traces = new TraceQueryService(new ClickHouseTraceRepository(read, clickhouse.database, clickhouse.maxConcurrentQueries));
    // el worker solo lee votos: el cliente de solo lectura hace de cliente de escritura, que aquí no se usa
    const feedback = new ClickHouseUserFeedbackRepository(read, read, clickhouse.database, clickhouse.maxConcurrentQueries);
    const identity = new PostgresIdentityRepository(pool);
    const repo = new PostgresAlertRepository(pool);

    const source = new TraceAlertMetricSource(traces, feedback, async (experimentId, metricId) => {
      const found = (await identity.listCustomMetrics(experimentId)).find((m) => m.id === metricId);
      return found ? found.definition : null;
    });
    const resendApiKey = process.env.RESEND_API_KEY;
    const email = resendApiKey ? new ResendEmailSender(resendApiKey, process.env.EMAIL_FROM ?? "MemTrace <invites@memtrace.local>") : new NoopEmailSender();
    const appUrl = process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";

    const started = Date.now();
    const summary = await new AlertEvaluator(repo, source, email, appUrl).run();
    console.log(
      `[alerts] rules=${summary.rules} fired=${summary.fired} resolved=${summary.resolved} reminders=${summary.reminders} budgets=${summary.budgets} budgetNotices=${summary.budgetNotices} failed=${summary.failed} in ${Date.now() - started} ms`,
    );
    const purged = await repo.purgeEventsOlderThan(new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000));
    if (purged > 0) console.log(`[alerts] history entries purged=${purged}`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[alerts] failed:", error);
  process.exit(1);
});
