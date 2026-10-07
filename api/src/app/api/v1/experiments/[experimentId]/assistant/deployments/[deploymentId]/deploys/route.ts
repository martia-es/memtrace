import { ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toDeployRunDto } from "@/adapters/inbound/http/assistant-mappers";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import type { DeployRunsResponse } from "@/adapters/inbound/http/contract";
import { getDeploy } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Historial de despliegues de un entorno, el más reciente primero (ADR-064). Quien ve la ficha. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; deploymentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const items = await getDeploy().history(experimentId, deploymentId, Number.isFinite(limit) ? limit : 20);
    const body: DeployRunsResponse = { items: items.map(toDeployRunDto) };
    return json(body);
  });
}
