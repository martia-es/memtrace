import { createClient, type ClickHouseClient } from "@clickhouse/client";

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  /** Credenciales del cliente de escritura (ADR-045). Sin configurar, se reutilizan las de lectura (desarrollo local). */
  writeUsername: string;
  writePassword: string;
  /** Credenciales del usuario de retención (ADR-080): solo SELECT y ALTER DELETE en las tablas de trazas. Sin configurar, las de lectura. */
  retentionUsername: string;
  retentionPassword: string;
  /** hilos máximos por consulta: el almacén local tiene muy poco margen (ver query-limiter.ts) */
  maxThreads: number;
  maxConcurrentQueries: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  const username = env.CLICKHOUSE_USER ?? "default";
  const password = env.CLICKHOUSE_PASSWORD ?? "";
  return {
    url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username,
    password,
    database: env.CLICKHOUSE_DATABASE ?? "memtrace",
    writeUsername: env.CLICKHOUSE_WRITE_USER ?? username,
    writePassword: env.CLICKHOUSE_WRITE_USER ? (env.CLICKHOUSE_WRITE_PASSWORD ?? "") : password,
    retentionUsername: env.CLICKHOUSE_RETENTION_USER ?? username,
    retentionPassword: env.CLICKHOUSE_RETENTION_USER ? (env.CLICKHOUSE_RETENTION_PASSWORD ?? "") : password,
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
 * Cliente con permiso de escritura para las tablas de evaluación: `eval_items`, `eval_scores` (ADR-044) y
 * `annotations` (ADR-037), usado por `ClickHouseScoreRepository` y `ClickHouseAnnotationRepository`. Solo inserta.
 * Con `CLICKHOUSE_WRITE_USER` (en k8s, `api_writer`, ADR-045) el propio ClickHouse impide escribir en
 * `otel_traces` o leer con esa conexión; sin él, se usa el usuario de lectura y el acotado es solo por convención.
 */
export function createEvaluationWriteClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.writeUsername,
    password: config.writePassword,
    database: config.database,
    request_timeout: 15_000,
  });
}

/**
 * Cliente del worker de retención (ADR-080): con `CLICKHOUSE_RETENTION_USER` (en k8s, `retention_worker`) ClickHouse solo le
 * deja leer y borrar en `otel_traces`, `otel_traces_trace_id_ts` y `span_topics`. Lo usa solo el CronJob de purga, nunca la API.
 */
export function createRetentionClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.retentionUsername,
    password: config.retentionPassword,
    database: config.database,
    request_timeout: 600_000,
    clickhouse_settings: { max_threads: config.maxThreads },
  });
}
