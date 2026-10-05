import { getExternalAccess } from "@/dependency-container";
import { scimError } from "@/domain/scim";

export const SCIM_CONTENT_TYPE = "application/scim+json";

export function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": SCIM_CONTENT_TYPE, "cache-control": "no-store" } });
}

export function scimProblem(status: number, detail: string, scimType?: string): Response {
  return scimJson(scimError(status, detail, scimType), status);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

class BadScimRequest extends Error {}

export interface ScimContext {
  organizationId: string;
  /** `https://host/api/scim/v2`, para los `meta.location` */
  baseUrl: string;
}

/** Cuerpo JSON de la petición; un cuerpo ilegible o que no es un objeto es un 400, no un 500. */
export async function scimBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* cae al error de abajo */
  }
  throw new BadScimRequest("Request body must be a JSON object");
}

/** Autentica con el token de portador de SCIM (ADR-052): cada token pertenece a una organización y solo ve la suya. */
export async function scimGuard(request: Request, run: (ctx: ScimContext) => Promise<Response>): Promise<Response> {
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const organizationId = bearer ? await getExternalAccess().externalRepository.resolveScimToken(bearer) : null;
    if (!organizationId) return scimProblem(401, "Invalid or missing bearer token");
    return await run({ organizationId, baseUrl: `${new URL(request.url).origin}/api/scim/v2` });
  } catch (error) {
    if (error instanceof BadScimRequest) return scimProblem(400, error.message, "invalidSyntax");
    console.error("[memtrace-api] SCIM error:", error);
    return scimProblem(500, "Internal server error");
  }
}

/** `startIndex` (1-based) y `count` de la query, con topes para que una petición no pida la tabla entera. */
export function scimPaging(request: Request): { startIndex: number; count: number } {
  const params = new URL(request.url).searchParams;
  const startIndex = Math.max(Number.parseInt(params.get("startIndex") ?? "1", 10) || 1, 1);
  const count = Math.min(Math.max(Number.parseInt(params.get("count") ?? "100", 10) || 100, 0), 200);
  return { startIndex, count };
}
