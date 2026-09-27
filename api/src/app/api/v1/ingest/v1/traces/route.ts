import { getIdentity } from "@/dependency-container";
import { problem } from "@/adapters/inbound/http/problem";

export const dynamic = "force-dynamic";

const COLLECTOR_URL = process.env.OTEL_COLLECTOR_HTTP_URL ?? "http://otel-collector:4318";

/**
 * Gateway de ingesta (ADR-013, pieza 9): exige una API key válida de algún experimento antes de
 * reenviar el OTLP/HTTP tal cual al Collector. Limitación conocida: no abre el body protobuf, así
 * que no comprueba que el `service.name` de los spans coincida con el experimento de la key — solo
 * que la key es válida y no ha sido revocada. Cerrar ese hueco requeriría parsear el payload OTLP.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return problem(401, "Unauthorized", "Missing API key");

  const { identityRepository } = getIdentity();
  const access = await identityRepository.resolveApiKey(bearer);
  if (!access) return problem(401, "Unauthorized", "Invalid or revoked API key");

  const body = await request.arrayBuffer();
  const upstream = await fetch(`${COLLECTOR_URL}/v1/traces`, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "application/x-protobuf" },
    body,
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}
