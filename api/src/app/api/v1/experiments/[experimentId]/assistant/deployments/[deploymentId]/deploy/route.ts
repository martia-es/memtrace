import { ASSISTANT_READ, DEPLOY_RUN, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toDeployRunDto } from "@/adapters/inbound/http/assistant-mappers";
import { deployBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import type { DeployPreviewDto } from "@/adapters/inbound/http/contract";
import { getDeploy } from "@/dependency-container";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ experimentId: string; deploymentId: string }> };

/** Qué se desplegaría ahora (rama → commit) y si el gate lo permite, sin lanzar nada. Quien ve la ficha. */
export async function GET(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const preview: DeployPreviewDto = await getDeploy().preview(experimentId, deploymentId);
    return json(preview);
  });
}

/**
 * Lanza el despliegue (ADR-064): dispara el workflow del repo del agente con el commit al que apunta hoy la rama del
 * entorno. Exige `deploy:run`; saltarse el gate (`bypassReason`) exige además `governance:manage`.
 */
export async function POST(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, DEPLOY_RUN);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(deployBody, request);
    const canBypass = ctx.permissions.includes("governance:manage");
    const run = await getDeploy().deploy(experimentId, deploymentId, { userId: ctx.user.id, canBypass, bypassReason: body.bypassReason });
    return json(toDeployRunDto(run), 202);
  });
}
