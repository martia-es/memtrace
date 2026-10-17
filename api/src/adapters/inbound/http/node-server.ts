import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { json, problem } from "@/adapters/inbound/http/problem";
import { METRICS_CONTENT_TYPE } from "@/adapters/inbound/http/metrics";

/** Ruta pública de la ingesta: la misma que servía la API, para que los SDK y los nginx no cambien. */
export const INGEST_PATH = "/api/v1/ingest/v1/traces";

export interface NodeServerOptions {
  /** Atiende `POST` de ingesta. */
  ingest: (request: Request) => Promise<Response>;
  /** Mientras devuelva `false` el servicio dice que no está listo (se está apagando) para que Kubernetes deje de enviarle tráfico. */
  isReady: () => boolean;
  /** Cuerpo de `/metrics` (formato de texto de Prometheus). Sin él, la ruta no existe. */
  metrics?: () => string;
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(`http://${req.headers.host ?? "ingest"}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Servidor HTTP mínimo del servicio `ingest`. Sin framework: solo hace falta una ruta de datos y dos de salud.
 *
 * - `/metrics`: lo lee Prometheus (ADR-098). No sale al exterior: nginx solo enruta `/api/v1/ingest/` y una política de red lo limita.
 * - `/health`: el proceso vive. No mira Postgres ni el Collector: una caída de ellos no debe reiniciar el pod.
 * - `/ready`: no está apagándose. Tampoco depende de Postgres a propósito, porque con la caché de keys (ADR-098) el
 *   servicio puede seguir aceptando datos sin él; sacarlo de los endpoints convertiría una caída parcial en total.
 */
export function createIngestServer(options: NodeServerOptions): Server {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = new URL(req.url ?? "/", "http://x").pathname;
        if (path === "/health") return await send(res, json({ status: "ok" }));
        if (path === "/ready") return await send(res, options.isReady() ? json({ status: "ready" }) : problem(503, "Service Unavailable", "Shutting down"));
        if (path === "/metrics" && options.metrics) {
          return await send(res, new Response(options.metrics(), { headers: { "content-type": METRICS_CONTENT_TYPE, "cache-control": "no-store" } }));
        }
        if (path !== INGEST_PATH) return await send(res, problem(404, "Not Found"));
        if (req.method !== "POST") {
          const response = problem(405, "Method Not Allowed");
          response.headers.set("Allow", "POST");
          return await send(res, response);
        }
        return await send(res, await options.ingest(toRequest(req)));
      } catch (error) {
        console.error("[ingest] unhandled error", error);
        if (!res.headersSent) await send(res, problem(500, "Internal Server Error"));
        else res.destroy();
      }
    })();
  });
  // por encima del `keepalive` de nginx: así es nginx quien cierra la conexión ociosa y no llegan peticiones a un socket ya cerrado
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}
