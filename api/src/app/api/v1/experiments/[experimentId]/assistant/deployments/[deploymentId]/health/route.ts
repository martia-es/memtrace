import { ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toHealthCheckDto } from "@/adapters/inbound/http/assistant-mappers";
import type { HealthHistoryResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Historial de sondeos de /health. `?hours=` (por defecto 24, máximo 720) y `?limit=` (por defecto 500, máximo 2000). */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; deploymentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    const clamp = (raw: string | null, fallback: number, max: number) => Math.min(Math.max(Number.parseInt(raw ?? "", 10) || fallback, 1), max);
    const checks = await getAssistantRegistry().healthHistory(experimentId, deploymentId, clamp(params.get("hours"), 24, 720), clamp(params.get("limit"), 500, 2000));
    return json({ items: checks.map(toHealthCheckDto) } satisfies HealthHistoryResponse);
  });
}
