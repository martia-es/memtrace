import type { ProblemDetails } from "./contract";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** RFC 7807 */
export function problem(status: number, title: string, detail?: string, errors?: Record<string, string>): Response {
  const body: ProblemDetails = { type: "about:blank", title, status, ...(detail ? { detail } : {}), ...(errors ? { errors } : {}) };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json", ...NO_STORE },
  });
}
