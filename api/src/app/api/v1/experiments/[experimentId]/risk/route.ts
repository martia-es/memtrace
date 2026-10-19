import { auditExperiment } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { toAssistantCardDto } from "@/adapters/inbound/http/assistant-mappers";
import { riskBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Clasifica el riesgo del agente (ADR-102): nivel, finalidad prevista y limitaciones. Requiere `governance:manage`; bajar el
 * nivel además exige `org:manage` (lo comprueba el servicio con `canLower`). Queda en la auditoría con el nivel anterior y el nuevo.
 */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "governance:manage");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(riskBody, request);
    const { card, previous } = await getAssistantRegistry().classifyRisk(experimentId, body, { id: ctx.user.id, canLower: ctx.permissions.includes("org:manage") });
    await auditExperiment(ctx.user, experimentId, "risk.classify", { type: "experiment", id: experimentId }, "strict", { from: previous, to: body.level });
    return json(toAssistantCardDto(card));
  });
}
