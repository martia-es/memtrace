import { gunzipSync } from "node:zlib";
import { getIdentity } from "@/dependency-container";
import { problem } from "@/adapters/inbound/http/problem";
import { MalformedOtlpError, rewriterFor } from "@/adapters/inbound/http/otlp-identity";

export const dynamic = "force-dynamic";

const COLLECTOR_URL = process.env.OTEL_COLLECTOR_HTTP_URL ?? "http://otel-collector:4318";
/** Tope del cuerpo recibido (comprimido) y del descomprimido: sin él una petición pequeña podría expandirse sin límite. */
const MAX_BODY_BYTES = Number(process.env.INGEST_MAX_BODY_BYTES ?? 10 * 1024 * 1024);
const MAX_DECOMPRESSED_BYTES = Number(process.env.INGEST_MAX_DECOMPRESSED_BYTES ?? 32 * 1024 * 1024);

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

/**
 * Gateway de ingesta (ADR-013 pieza 9, ADR-078): exige una API key válida y **asigna la identidad del tenant**.
 * Abre el OTLP, sustituye `service.name` y `memtrace.experiment_id` de cada Resource por los del experimento de la
 * key y reenvía al Collector. Lo que el agente declare como suyo se descarta: el tenant de un span lo decide la
 * plataforma. Un `service.name` distinto al del experimento no falla la ingesta (suele ser un agente mal
 * configurado) pero se registra.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return problem(401, "Unauthorized", "Missing API key");

  const { identityRepository } = getIdentity();
  const access = await identityRepository.resolveApiKey(bearer);
  if (!access) return problem(401, "Unauthorized", "Invalid or revoked API key");

  const contentType = request.headers.get("content-type");
  const rewrite = rewriterFor(contentType);
  if (!rewrite) return problem(415, "Unsupported Media Type", "Use application/x-protobuf or application/json");

  try {
    let body = await readBounded(request, MAX_BODY_BYTES);
    const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
    if (encoding === "gzip") body = gunzipSync(body, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    else if (encoding !== "identity") return problem(415, "Unsupported Media Type", "Content-Encoding must be gzip or identity");

    const { body: rewritten, mismatchedResources } = rewrite(body, { experimentId: access.experimentId, serviceName: access.serviceName });
    if (mismatchedResources > 0) {
      console.warn(JSON.stringify({ event: "ingest.service_name_mismatch", experimentId: access.experimentId, resources: mismatchedResources }));
    }

    const upstream = await fetch(`${COLLECTOR_URL}/v1/traces`, {
      method: "POST",
      headers: { "content-type": contentType ?? "application/x-protobuf" },
      body: rewritten as BodyInit,
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch (error) {
    if (error instanceof PayloadTooLarge) return problem(413, "Payload Too Large", "OTLP payload exceeds the allowed size");
    if (error instanceof MalformedOtlpError) return problem(400, "Bad Request", `Invalid OTLP payload: ${error.message}`);
    if (error instanceof RangeError || (error as NodeJS.ErrnoException)?.code?.startsWith?.("Z_")) {
      return problem(400, "Bad Request", "Invalid or oversized compressed payload");
    }
    throw error;
  }
}
