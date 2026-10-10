import { gunzipSync } from "node:zlib";
import { getIdentity } from "@/dependency-container";
import { problem } from "@/adapters/inbound/http/problem";
import { OtlpParseError, checkServiceNames, serviceNamesFromJson, serviceNamesFromProtobuf } from "@/domain/otlp-resource";

export const dynamic = "force-dynamic";

const COLLECTOR_URL = process.env.OTEL_COLLECTOR_HTTP_URL ?? "http://otel-collector:4318";
/** Tamaño máximo del cuerpo tal como llega y una vez descomprimido: un OTLP normal son unos KB, el exportador agrupa por lotes. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * Gateway de ingesta (ADR-013, pieza 9; ADR-085): exige una API key válida y que cada recurso de la petición lleve el
 * `service.name` del experimento de esa key, antes de reenviar el OTLP/HTTP tal cual al Collector. Una key de un experimento
 * no puede escribir en otro: la retención, la auditoría y todas las consultas se apoyan en ese nombre.
 * Solo lee la cabecera de cada recurso (no decodifica spans). El cuerpo original, comprimido o no, es lo que se reenvía.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return problem(401, "Unauthorized", "Missing API key");

  const { identityRepository } = getIdentity();
  const access = await identityRepository.resolveApiKey(bearer);
  if (!access) return problem(401, "Unauthorized", "Invalid or revoked API key");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return problem(413, "Payload Too Large", `The request can be at most ${MAX_BODY_BYTES} bytes`);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) return problem(413, "Payload Too Large", `The request can be at most ${MAX_BODY_BYTES} bytes`);

  const contentType = request.headers.get("content-type") ?? "application/x-protobuf";
  const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();

  let plain: Uint8Array;
  if (encoding === "identity" || encoding === "") plain = body;
  else if (encoding === "gzip") {
    try {
      plain = gunzipSync(body, { maxOutputLength: MAX_INFLATED_BYTES });
    } catch {
      return problem(400, "Bad Request", "The request body is not valid gzip, or it is too large once decompressed");
    }
  } else return problem(415, "Unsupported Media Type", `Content-Encoding ${encoding} is not supported; use gzip or none`);

  let names;
  try {
    names = /^application\/json\b/i.test(contentType) ? serviceNamesFromJson(new TextDecoder().decode(plain)) : serviceNamesFromProtobuf(plain);
  } catch (error) {
    if (error instanceof OtlpParseError) return problem(400, "Bad Request", `Not a valid OTLP traces request: ${error.message}`);
    throw error;
  }

  const verdict = checkServiceNames(names, access.serviceName);
  if (!verdict.ok) {
    console.warn(`[ingest] rejected: experiment ${access.experimentId} sent ${verdict.reason === "missing" ? "no service.name" : `service.name ${JSON.stringify(verdict.found)}`}`);
    return problem(
      403,
      "Forbidden",
      verdict.reason === "missing"
        ? `Every resource must carry service.name = "${access.serviceName}" (the one of this API key's experiment)`
        : `This API key belongs to service.name "${access.serviceName}" and cannot write traces for "${verdict.found}"`,
    );
  }

  const headers: Record<string, string> = { "content-type": contentType };
  if (encoding !== "identity" && encoding !== "") headers["content-encoding"] = encoding;
  const upstream = await fetch(`${COLLECTOR_URL}/v1/traces`, { method: "POST", headers, body });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}
