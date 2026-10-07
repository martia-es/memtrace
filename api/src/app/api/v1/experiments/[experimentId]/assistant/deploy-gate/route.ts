import { ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getDeployGate } from "@/dependency-container";
import type { DeployGateDto } from "@/adapters/inbound/http/contract";

export const dynamic = "force-dynamic";

/**
 * ¿Puede desplegarse este commit? (ADR-064). `?sha=` obligatorio. Solo lee: dice si hay una evaluación exitosa de ese
 * commit y, si no la hay, por qué. `governance:read` o `assistant:manage`.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const sha = new URL(request.url).searchParams.get("sha") ?? "";
    const result: DeployGateDto = await getDeployGate().check(experimentId, sha);
    return json(result);
  });
}
