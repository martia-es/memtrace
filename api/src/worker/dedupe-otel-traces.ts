/**
 * Cambia `otel_traces` por su versión sin duplicados (ADR-099) sin parar la ingesta. Una pasada, repetible, pensada para un Job de
 * Kubernetes (o `make dedupe`). Necesita un usuario de ClickHouse con CREATE/DROP/INSERT/SELECT y EXCHANGE (el `default` del clúster
 * local), no el de solo lectura de la API. Espera a que la migración 017 haya creado la tabla nueva.
 */
import { createClient } from "@clickhouse/client";
import { configFromEnv } from "@/adapters/outbound/clickhouse/client";
import { OtelTracesDedupe } from "@/adapters/outbound/clickhouse/otel-traces-dedupe";

async function main() {
  const config = configFromEnv();
  const client = createClient({ url: config.url, username: config.username, password: config.password, database: config.database, request_timeout: 3_600_000,
    // copias largas: sin latidos del servidor, un balanceador o un proxy podrían cortar la conexión
    clickhouse_settings: { send_progress_in_http_headers: 1, http_headers_progress_interval_ms: "30000" },
  });
  try {
    const catchupHours = Number(process.env.DEDUPE_CATCHUP_HOURS ?? 24);
    const dedupe = new OtelTracesDedupe(client, config.database, { catchupHours });
    if (process.env.DEDUPE_ACTION === "drop-previous") {
      console.log((await dedupe.dropPrevious()) ? "[dedupe] previous table dropped" : "[dedupe] there is no previous table");
      return;
    }
    // la migración y este Job arrancan a la vez: se espera (hasta 10 min) a que exista la tabla nueva
    for (let attempt = 0; ; attempt++) {
      try {
        const report = await dedupe.run();
        console.log(`[dedupe] ${report.status}: ${report.copiedDays} day(s) copied, window ${report.windowSpans.new}/${report.windowSpans.old} span(s)`);
        return;
      } catch (error) {
        const waiting = error instanceof Error && /migration 017 has not run|does not exist: run the ClickHouse migrations/.test(error.message);
        if (!waiting || attempt >= 60) throw error;
        console.log(`[dedupe] waiting for the migrations (${error.message})`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[dedupe] failed:", error);
  process.exit(1);
});
