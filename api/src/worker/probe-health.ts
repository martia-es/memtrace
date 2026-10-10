/**
 * Worker de /health (ADR-053): una pasada por ejecución, pensada para un CronJob de Kubernetes cada minuto.
 * Se empaqueta con esbuild (`npm run build:worker`) porque la imagen de la API es un servidor Next `standalone`.
 * Raíz de composición propia, como `dependency-container.ts`: aquí se eligen los adapters y se lee el entorno.
 */
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv as clickhouseConfigFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { PostgresAssistantRegistryRepository } from "@/adapters/outbound/postgres/postgres-assistant-registry-repository";
import { configFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import { HttpHealthProber } from "@/adapters/outbound/http/http-health-prober";
import { AssistantRegistryService } from "@/application/assistant-registry-service";
import { runHealthProbes, shouldSyncObserved } from "@/application/health-probe-runner";
import { TraceQueryService } from "@/application/trace-query-service";

async function main() {
  const pool = createPool(configFromEnv());
  try {
    // las tools observadas salen de las trazas (ClickHouse), igual que en la API
    const clickhouse = clickhouseConfigFromEnv();
    const traces = new TraceQueryService(new ClickHouseTraceRepository(createReadOnlyClient(clickhouse), clickhouse.database, clickhouse.maxConcurrentQueries));
    const registry = new AssistantRegistryService(new PostgresAssistantRegistryRepository(pool), {
      toolUsage: async (scope, from, to) => (await traces.getOverview({ scope, from, to })).byTool,
    });
    const prober = new HttpHealthProber({
      timeoutMs: Number(process.env.HEALTH_PROBE_TIMEOUT_MS ?? 5000),
      allowPrivateNetworks: process.env.HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS === "true",
    });
    const started = Date.now();
    const summary = await runHealthProbes(registry, prober);
    console.log(
      `[health-probe] probed=${summary.probed} changes=${summary.changes.length}${summary.pruned !== null ? ` pruned=${summary.pruned}` : ""} in ${Date.now() - started} ms`,
    );
    for (const c of summary.changes) console.log(`[health-probe] ${c.deploymentId}: ${c.from} -> ${c.to}`);

    // conexiones observadas: cada 10 minutos, o al momento con `--sync` (p. ej. `kubectl create job --from=cronjob/health-probe`)
    if (process.argv.includes("--sync") || shouldSyncObserved(new Date())) {
      const sync = await registry.syncAllObservedConnections();
      console.log(`[observed-sync] experiments=${sync.experiments} tools=${sync.observed} failed=${sync.failed}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[health-probe] failed:", error);
  process.exit(1);
});
