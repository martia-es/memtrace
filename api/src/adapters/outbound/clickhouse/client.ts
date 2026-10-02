import { createClient, type ClickHouseClient } from "@clickhouse/client";

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  /** hilos máximos por consulta: el almacén local tiene muy poco margen (ver query-limiter.ts) */
  maxThreads: number;
  maxConcurrentQueries: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: env.CLICKHOUSE_USER ?? "default",
    password: env.CLICKHOUSE_PASSWORD ?? "",
    database: env.CLICKHOUSE_DATABASE ?? "memtrace",
    maxThreads: Number(env.CLICKHOUSE_QUERY_MAX_THREADS ?? 2),
    maxConcurrentQueries: Number(env.CLICKHOUSE_MAX_CONCURRENT_QUERIES ?? 3),
  };
}

/**
 * Cliente sin permisos de escritura: la API nunca escribe en el almacén.
 * `readonly=2` prohíbe escrituras pero, a diferencia de `1`, permite fijar `max_threads` por consulta.
 */
export function createReadOnlyClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: 15_000,
    clickhouse_settings: { readonly: "2", max_threads: config.maxThreads },
  });
}

/**
 * Cliente con permiso de escritura, usado exclusivamente por `ClickHouseScoreRepository` para
 * insertar en `scores` (ADR-028). No lo uses para nada más: la regla "la API nunca escribe
 * trazas" sigue vigente — este cliente nunca toca `otel_traces` ni las tablas relacionadas.
 */
export function createScoresWriteClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: 15_000,
  });
}
