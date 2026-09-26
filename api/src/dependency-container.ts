/** Composition root: único sitio donde se eligen los adapters concretos y se lee el entorno. */
import { TraceQueryService } from "@/application/trace-query-service";
import { createHandlers, type Handlers } from "@/adapters/inbound/http/handlers";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";

// En `next dev` los módulos se recargan: el contenedor se cachea en globalThis para no abrir conexiones nuevas
const globalForContainer = globalThis as unknown as { __memtraceHandlers?: Handlers };

export function getHandlers(): Handlers {
  if (!globalForContainer.__memtraceHandlers) {
    const config = configFromEnv();
    const repository = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries);
    globalForContainer.__memtraceHandlers = createHandlers(new TraceQueryService(repository));
  }
  return globalForContainer.__memtraceHandlers;
}
