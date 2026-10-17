/**
 * Servicio `ingest` (ADR-098): la pasarela de ingesta como proceso propio, sin estado y con N réplicas. Separa la escritura
 * (continua, en segundo plano) de la consulta (puntual, a demanda), como exige el roadmap: un pico de ingesta ya no frena el
 * dashboard. Solo necesita Postgres (validar API keys) y el Collector; no tiene credenciales de ClickHouse ni de login.
 *
 * Composition root de este servicio: único sitio que lee el entorno.
 */
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { configFromEnv as postgresConfigFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import { createIngestGateway } from "@/adapters/inbound/http/ingest-gateway";
import { MetricsRegistry } from "@/adapters/inbound/http/metrics";
import { createIngestServer } from "@/adapters/inbound/http/node-server";
import { CachedApiKeyResolver } from "@/application/api-key-cache";

const env = process.env;
const number = (name: string, fallback: number) => {
  const value = Number(env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

let ready = true;
const port = number("PORT", 3002);
const host = env.HOSTNAME ?? "0.0.0.0";

// Tiempos cortos: si Postgres no responde se quiere saberlo enseguida para usar la caché, no esperar sin límite
const pool = createPool(postgresConfigFromEnv(env), {
  max: number("INGEST_POSTGRES_POOL_SIZE", 10),
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 30_000,
  query_timeout: 3_000,
});
// un cliente ocioso que Postgres cierra emite `error`; sin este manejador el proceso caería
pool.on("error", (error) => console.error("[ingest] postgres pool error", error));

// Métricas para Prometheus (ADR-098): lo que hace falta para saber si la ingesta está sana sin mirar los logs
const metrics = new MetricsRegistry();
const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const requests = metrics.counter("memtrace_ingest_requests_total", "Requests answered, by HTTP status code.");
const duration = metrics.histogram("memtrace_ingest_request_duration_seconds", "Time to answer an ingest request.", SECONDS);
const rejections = metrics.counter("memtrace_ingest_rejections_total", "Requests refused, by reason.");
const forwards = metrics.counter("memtrace_ingest_forward_total", "Calls to the Collector, by outcome.");
const forwardDuration = metrics.histogram("memtrace_ingest_forward_duration_seconds", "Time the Collector took to answer.", SECONDS);
const forwardedBytes = metrics.counter("memtrace_ingest_forwarded_bytes_total", "Bytes of OTLP sent to the Collector.");
const keyCache = metrics.counter("memtrace_ingest_key_cache_total", "API key lookups: hit, miss, stale (identity store down, remembered key accepted) or failure.");

const identity = new PostgresIdentityRepository(pool);
const keys = new CachedApiKeyResolver((plaintext) => identity.resolveApiKey(plaintext), {
  onEvent: (result) => keyCache.inc({ result }),
  ttlMs: number("INGEST_KEY_CACHE_TTL_SECONDS", 30) * 1000,
  staleMs: number("INGEST_KEY_CACHE_STALE_SECONDS", 600) * 1000,
  maxEntries: number("INGEST_KEY_CACHE_MAX_ENTRIES", 10_000),
});

metrics.gauge("memtrace_ingest_key_cache_entries", "API keys remembered right now.", () => keys.size);
metrics.gauge("memtrace_ingest_identity_store_up", "1 while the identity store (Postgres) answers, 0 from its last failure until it answers again.", () => (keys.sourceHealthy ? 1 : 0));
metrics.gauge("memtrace_ingest_ready", "1 while the service accepts traffic, 0 while draining.", () => (ready ? 1 : 0));
metrics.gauge("process_resident_memory_bytes", "Resident memory of the process.", () => process.memoryUsage().rss);
metrics.gauge("process_start_time_seconds", "Start time of the process, in seconds since the epoch.", () => Math.floor(Date.now() / 1000 - process.uptime()));

const collectorToken = env.INGEST_INTERNAL_TOKEN;
if (!collectorToken) console.warn("[ingest] INGEST_INTERNAL_TOKEN is not set: the Collector will reject the traces (ADR-090)");

const gateway = createIngestGateway({
  resolveApiKey: keys.resolve,
  collectorUrl: env.OTEL_COLLECTOR_HTTP_URL ?? "http://otel-collector:4318",
  collectorToken,
  maxBodyBytes: number("INGEST_MAX_BODY_BYTES", 16 * 1024 * 1024),
  maxDecompressedBytes: number("INGEST_MAX_DECOMPRESSED_BYTES", 64 * 1024 * 1024),
  perExperimentLimitPerMinute: number("INGEST_RATE_LIMIT_PER_MINUTE", 600),
  invalidKeyLimitPerMinute: number("INGEST_INVALID_KEY_LIMIT_PER_MINUTE", 30),
  forwardTimeoutMs: number("INGEST_FORWARD_TIMEOUT_MS", 10_000),
  onEvent: (event) => {
    if (event.kind === "rejected") return rejections.inc({ reason: event.reason });
    forwards.inc({ outcome: event.outcome });
    forwardDuration.observe(event.seconds);
    forwardedBytes.inc({}, event.bytes);
  },
});

const server = createIngestServer({
  ingest: async (request) => {
    const started = process.hrtime.bigint();
    const response = await gateway(request);
    requests.inc({ code: String(response.status) });
    duration.observe(Number(process.hrtime.bigint() - started) / 1e9);
    return response;
  },
  isReady: () => ready,
  metrics: () => metrics.render(),
});

// `last_used_at` se actualiza sin esperar; si Postgres falla justo entonces no debe tumbar el proceso
process.on("unhandledRejection", (reason) => console.error("[ingest] unhandled rejection", reason));

/** Apagado ordenado: primero deja de estar listo (Kubernetes retira el pod del Service), luego cierra con las peticiones en curso. */
function shutdown(signal: string) {
  if (!ready) return;
  ready = false;
  console.log(`[ingest] ${signal}: draining`);
  const drainMs = number("INGEST_SHUTDOWN_DELAY_SECONDS", 5) * 1000;
  setTimeout(() => {
    server.close(() => void pool.end().finally(() => process.exit(0)));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 20_000).unref(); // si algo se queda colgado, no se bloquea el apagado
  }, drainMs).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(port, host, () => console.log(`[ingest] listening on ${host}:${port}`));
