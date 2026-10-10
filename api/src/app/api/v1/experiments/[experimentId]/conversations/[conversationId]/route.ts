import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; conversationId: string }> }) {
  const { experimentId, conversationId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  // Acotado al experimento (ADR-088): el id de conversación lo elige el cliente y puede repetirse entre organizaciones.
  return getHandlers().getConversation(request, access.scope, conversationId);
}
