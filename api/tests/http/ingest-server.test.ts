/**
 * El servicio `ingest` (ADR-098) de punta a punta dentro del proceso: un servidor HTTP real delante del gateway y otro que
 * hace de Collector. Comprueba lo que los tests del gateway no ven: el adaptador de Node (cuerpo en streaming, gzip, cabeceras),
 * las rutas de salud y el comportamiento cuando Postgres o el Collector fallan.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIngestGateway } from "@/adapters/inbound/http/ingest-gateway";
import { createIngestServer, INGEST_PATH } from "@/adapters/inbound/http/node-server";
import { CachedApiKeyResolver } from "@/application/api-key-cache";

const ACCESS = { experimentId: "exp-1", serviceName: "agent-a", createdByUserId: "u1" };
const body = JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "agent-a" } }] }, scopeSpans: [] }] });

let collector: Server;
let ingest: Server;
let ingestUrl: string;
let received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }>;
let collectorStatus = 200;
let postgresDown = false;
let ready = true;

const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });

beforeAll(async () => {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(collectorStatus, { "content-type": "application/json", "x-internal-header": "must-not-leak" });
      res.end('{"partialSuccess":{}}');
    });
  });
  const collectorUrl = await listen(collector);

  const keys = new CachedApiKeyResolver(
    async (key) => {
      if (postgresDown) throw new Error("postgres down");
      return key === "good" ? ACCESS : null;
    },
    { ttlMs: 0, staleMs: 600_000, maxEntries: 100, failureBackoffMs: 0 },
  );
  const gateway = createIngestGateway({
    resolveApiKey: keys.resolve,
    collectorUrl,
    collectorToken: "internal-token",
    maxBodyBytes: 16 * 1024 * 1024,
    maxDecompressedBytes: 64 * 1024 * 1024,
    perExperimentLimitPerMinute: 600,
    invalidKeyLimitPerMinute: 30,
    forwardTimeoutMs: 2_000,
  });
  ingest = createIngestServer({ ingest: gateway, isReady: () => ready });
  ingestUrl = await listen(ingest);
});
afterAll(async () => {
  await close(ingest);
  await close(collector);
});
beforeEach(() => {
  received = [];
  collectorStatus = 200;
  postgresDown = false;
  ready = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const post = (payload: string | Uint8Array, headers: Record<string, string> = {}) =>
  fetch(`${ingestUrl}${INGEST_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer good", ...headers }, body: payload as BodyInit });

describe("ingest server", () => {
  it("serves the same public path the API used to, and forwards to the Collector with the internal token", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers.authorization).toBe("Bearer internal-token");
    expect(received[0]!.body).toContain("exp-1"); // memtrace.experiment_id estampado (ADR-089)
  });

  it("decompresses a gzip body streamed over a real socket", async () => {
    const res = await post(gzipSync(body), { "content-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(received[0]!.body).toContain("exp-1");
  });

  it("does not leak the Collector's own headers back to the agent", async () => {
    const res = await post(body);
    expect(res.headers.get("x-internal-header")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("answers 401 without touching the Collector for an invalid key", async () => {
    expect((await post(body, { authorization: "Bearer nope" })).status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it("answers 503 with Retry-After, not 500, when the identity store is down and the key was never seen", async () => {
    postgresDown = true;
    const res = await post(body, { authorization: "Bearer never-seen-before" });
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(received).toHaveLength(0);
  });

  it("keeps ingesting with a key validated earlier while the identity store is down", async () => {
    expect((await post(body)).status).toBe(200); // se valida y se recuerda
    postgresDown = true;
    expect((await post(body)).status).toBe(200);
    expect(received).toHaveLength(2);
  });

  it("answers 503 with Retry-After when the Collector is unreachable", async () => {
    const lonely = createIngestServer({
      ingest: createIngestGateway({
        resolveApiKey: async () => ACCESS,
        collectorUrl: "http://127.0.0.1:1", // nadie escucha
        maxBodyBytes: 1024 * 1024,
        maxDecompressedBytes: 1024 * 1024,
        perExperimentLimitPerMinute: 600,
        invalidKeyLimitPerMinute: 30,
        forwardTimeoutMs: 2_000,
      }),
      isReady: () => true,
    });
    const url = await listen(lonely);
    try {
      const res = await fetch(`${url}${INGEST_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer good" }, body });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
    } finally {
      await close(lonely);
    }
  });

  it("passes a Collector failure back so the agent can retry", async () => {
    collectorStatus = 503;
    expect((await post(body)).status).toBe(503);
  });
});

describe("health routes", () => {
  it("/health does not depend on the identity store or the Collector", async () => {
    postgresDown = true;
    expect((await fetch(`${ingestUrl}/health`)).status).toBe(200);
  });

  it("/ready is 200 until the service starts draining", async () => {
    expect((await fetch(`${ingestUrl}/ready`)).status).toBe(200);
    ready = false;
    expect((await fetch(`${ingestUrl}/ready`)).status).toBe(503);
  });

  it("only knows the ingest path, and only with POST", async () => {
    expect((await fetch(`${ingestUrl}/api/v1/experiments`)).status).toBe(404);
    const res = await fetch(`${ingestUrl}${INGEST_PATH}`);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
