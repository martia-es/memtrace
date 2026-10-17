/**
 * Mantenimiento periódico de `otel_traces` (ADR-099): compacta los días cerrados y borra la tabla anterior al cambio pasados unos
 * días. Una pasada, idempotente, pensada para un CronJob. Necesita OPTIMIZE y DROP: el usuario `default` del clúster local.
 */
import { createClient } from "@clickhouse/client";
import { configFromEnv } from "@/adapters/outbound/clickhouse/client";
import { OtelTracesMaintenance } from "@/adapters/outbound/clickhouse/otel-traces-maintenance";

async function main() {
  const config = configFromEnv();
  const client = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: 3_600_000,
    clickhouse_settings: { send_progress_in_http_headers: 1, http_headers_progress_interval_ms: "30000" },
  });
  try {
    const report = await new OtelTracesMaintenance(client, config.database, {
      recentDays: Number(process.env.MAINTAIN_RECENT_DAYS ?? 2),
      maxPartitions: Number(process.env.MAINTAIN_MAX_PARTITIONS ?? 50),
      keepPreviousDays: Number(process.env.MAINTAIN_KEEP_PREVIOUS_DAYS ?? 7),
    }).run();
    console.log(`[maintain] done: ${report.compacted.length} partition(s) compacted${report.droppedPrevious ? ", previous table dropped" : ""}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[maintain] failed:", error);
  process.exit(1);
});
