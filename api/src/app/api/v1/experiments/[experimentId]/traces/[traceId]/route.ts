import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; traceId: string }> }) {
  const { experimentId, traceId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  // El lookup va acotado al experimento (ADR-077): una traza de otro experimento responde 404, aunque se conozca su id.
  return getHandlers().getTrace(request, access.scope, traceId);
}
