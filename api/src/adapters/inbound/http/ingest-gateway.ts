import { gunzipSync } from "node:zlib";
import { problem } from "@/adapters/inbound/http/problem";
import { MalformedOtlpError, rewriterFor } from "@/adapters/inbound/http/otlp-identity";
import { RateLimiter } from "@/application/rate-limiter";
import type { ApiKeyResolver } from "@/application/api-key-cache";
import { OtlpParseError, checkServiceNames, serviceNamesFromJson, serviceNamesFromProtobuf } from "@/domain/otlp-resource";

/** Lo que el gateway cuenta a quien quiera medirlo (ADR-098): un rechazo con su motivo, o el resultado de reenviar al Collector. */
export type IngestEvent =
  | { kind: "rejected"; reason: "missing_key" | "invalid_key" | "blocked_origin" | "rate_limited" | "identity_unavailable" | "unsupported_media" | "forbidden_service" | "bad_payload" | "too_large" }
  | { kind: "forwarded"; outcome: "ok" | "collector_status" | "collector_unreachable"; seconds: number; bytes: number };

export interface IngestGatewayOptions {
  resolveApiKey: ApiKeyResolver;
  collectorUrl: string;
  /** Secreto que solo esta pasarela y el Collector comparten (ADR-090): sin él, el Collector rechaza lo que le llegue por otra vía. */
  collectorToken?: string;
  /** Tope del cuerpo recibido (comprimido) y del descomprimido: sin él una petición pequeña podría expandirse sin límite. */
  maxBodyBytes: number;
  maxDecompressedBytes: number;
  /**
   * Límites (ADR-092). Por experimento: un agente en un bucle o una clave filtrada no puede saturar el Collector. Por origen,
   * solo las claves inválidas: frena el sondeo de claves sin gastar una consulta a Postgres por intento. En memoria de cada
   * réplica.
   */
  perExperimentLimitPerMinute: number;
  invalidKeyLimitPerMinute: number;
  /** Cuánto se espera al Collector antes de decir al agente que reintente. */
  forwardTimeoutMs: number;
  fetch?: typeof fetch;
  onEvent?: (event: IngestEvent) => void;
}

class PayloadTooLarge extends Error {}

async function readBounded(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new PayloadTooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new PayloadTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** El origen es el último salto de X-Forwarded-For: lo añade nuestro nginx; lo anterior lo puede escribir el cliente. */
function clientOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? (forwarded.split(",").pop() ?? "").trim() || "unknown" : "unknown";
}

function tooMany(retryAfterSeconds: number): Response {
  const response = problem(429, "Too Many Requests", "Rate limit exceeded");
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

/**
 * 503 y no 500: los exportadores OTLP reintentan 429, 502, 503 y 504, pero no un 500. Un fallo de Postgres o del Collector
 * es transitorio y el agente debe reintentar en vez de perder el lote.
 */
function unavailable(detail: string): Response {
  const response = problem(503, "Service Unavailable", detail);
  response.headers.set("Retry-After", "5");
  return response;
}

/**
 * Gateway de ingesta (ADR-013 pieza 9, ADR-085, ADR-089, ADR-098): exige una API key válida, rechaza (403) un `service.name`
 * que no sea el del experimento de la key y **asigna la identidad del tenant**: sustituye `service.name` y
 * `memtrace.experiment_id` de cada Resource por los del experimento y reenvía al Collector. Lo que el agente declare como
 * suyo se descarta: el tenant de un span lo decide la plataforma.
 *
 * No depende de ningún framework: recibe una `Request` y devuelve una `Response`. Lo sirve el servicio `ingest`.
 */
export function createIngestGateway(options: IngestGatewayOptions): (request: Request) => Promise<Response> {
  const perExperiment = new RateLimiter(options.perExperimentLimitPerMinute, 60_000);
  const invalidKeys = new RateLimiter(options.invalidKeyLimitPerMinute, 60_000);
  const send: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);
  const emit = (event: IngestEvent) => options.onEvent?.(event);
  const reject = (reason: Extract<IngestEvent, { kind: "rejected" }>["reason"], response: Response) => {
    emit({ kind: "rejected", reason });
    return response;
  };

  return async function handle(request: Request): Promise<Response> {
    const auth = request.headers.get("authorization");
    const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
    const origin = clientOf(request);
    const blocked = invalidKeys.peek(origin);
    if (blocked.remaining === 0) return reject("blocked_origin", tooMany(blocked.retryAfterSeconds)); // ya agotó sus intentos fallidos de este minuto
    if (!bearer) {
      invalidKeys.hit(origin);
      return reject("missing_key", problem(401, "Unauthorized", "Missing API key"));
    }

    let access;
    try {
      access = await options.resolveApiKey(bearer);
    } catch (error) {
      console.error("[ingest] cannot validate the API key (identity store unavailable)", error);
      return reject("identity_unavailable", unavailable("Cannot validate the API key right now; retry"));
    }
    if (!access) {
      invalidKeys.hit(origin);
      return reject("invalid_key", problem(401, "Unauthorized", "Invalid or revoked API key"));
    }
    const decision = perExperiment.hit(access.experimentId);
    if (!decision.allowed) return reject("rate_limited", tooMany(decision.retryAfterSeconds));

    const contentType = request.headers.get("content-type");
    const rewrite = rewriterFor(contentType);
    if (!rewrite) return reject("unsupported_media", problem(415, "Unsupported Media Type", "Use application/x-protobuf or application/json"));

    let rewritten: Uint8Array;
    try {
      let body = await readBounded(request, options.maxBodyBytes);
      const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
      if (encoding === "gzip") body = gunzipSync(body, { maxOutputLength: options.maxDecompressedBytes });
      else if (encoding !== "identity") return reject("unsupported_media", problem(415, "Unsupported Media Type", "Content-Encoding must be gzip or identity"));

      const verdict = checkServiceNames(
        /^application\/json\b/i.test(contentType ?? "") ? serviceNamesFromJson(new TextDecoder().decode(body)) : serviceNamesFromProtobuf(body),
        access.serviceName,
      );
      if (!verdict.ok) {
        console.warn(`[ingest] rejected: experiment ${access.experimentId} sent ${verdict.reason === "missing" ? "no service.name" : `service.name ${JSON.stringify(verdict.found)}`}`);
        return reject(
          "forbidden_service",
          problem(
            403,
            "Forbidden",
            verdict.reason === "missing"
              ? `Every resource must carry service.name = "${access.serviceName}" (the one of this API key's experiment)`
              : `This API key belongs to service.name "${access.serviceName}" and cannot write traces for "${verdict.found}"`,
          ),
        );
      }
      rewritten = rewrite(body, { experimentId: access.experimentId, serviceName: access.serviceName }).body;
    } catch (error) {
      if (error instanceof PayloadTooLarge) return reject("too_large", problem(413, "Payload Too Large", "OTLP payload exceeds the allowed size"));
      if (error instanceof OtlpParseError) return reject("bad_payload", problem(400, "Bad Request", `Not a valid OTLP traces request: ${error.message}`));
      if (error instanceof MalformedOtlpError) return reject("bad_payload", problem(400, "Bad Request", `Invalid OTLP payload: ${error.message}`));
      if (error instanceof RangeError || (error as NodeJS.ErrnoException)?.code?.startsWith?.("Z_")) {
        return reject("bad_payload", problem(400, "Bad Request", "Invalid or oversized compressed payload"));
      }
      throw error;
    }

    let upstream: Response;
    const startedForward = Date.now();
    try {
      upstream = await send(`${options.collectorUrl}/v1/traces`, {
        method: "POST",
        headers: { "content-type": contentType ?? "application/x-protobuf", ...(options.collectorToken ? { authorization: `Bearer ${options.collectorToken}` } : {}) },
        body: rewritten as BodyInit,
        signal: AbortSignal.timeout(options.forwardTimeoutMs),
      });
    } catch (error) {
      console.error("[ingest] the Collector did not answer", error);
      emit({ kind: "forwarded", outcome: "collector_unreachable", seconds: (Date.now() - startedForward) / 1000, bytes: rewritten.length });
      return unavailable("The ingestion pipeline is not accepting data right now; retry");
    }
    // solo lo necesario de la respuesta del Collector: reenviar sus cabeceras tal cual puede describir un cuerpo que ya no es el mismo
    const headers = new Headers();
    for (const name of ["content-type", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    emit({ kind: "forwarded", outcome: upstream.ok ? "ok" : "collector_status", seconds: (Date.now() - startedForward) / 1000, bytes: rewritten.length });
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  };
}
