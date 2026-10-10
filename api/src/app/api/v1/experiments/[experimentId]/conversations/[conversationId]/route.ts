import { getHandlers } from "@/dependency-container";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { auditExperiment } from "@/adapters/inbound/http/audit-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; conversationId: string }> }) {
  const { experimentId, conversationId } = await context.params;
  const access = await requirePermission(experimentId, "experiment:read");
  if (access instanceof Response) return access;
  // quién abrió el contenido de una conversación (ADR-080): detalle, transcripción y árbol cuentan como una apertura
  await auditExperiment(access.user, experimentId, "conversation.view", { type: "conversation", id: conversationId }, "view");
  // Nota (ADR-013): igual que en traces/[traceId], el lookup es global por conversationId.
  return getHandlers().getConversation(request, conversationId);
}
