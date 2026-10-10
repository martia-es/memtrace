import { getHandlers } from "@/dependency-container";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { auditExperiment } from "@/adapters/inbound/http/audit-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; traceId: string }> }) {
  const { experimentId, traceId } = await context.params;
  const access = await requirePermission(experimentId, "experiment:read");
  if (access instanceof Response) return access;
  // quién abrió el contenido de una traza (ADR-084)
  await auditExperiment(access.user, experimentId, "trace.view", { type: "trace", id: traceId }, "view");
  // El lookup va acotado al experimento (ADR-088): una traza de otro experimento responde 404, aunque se conozca su id.
  return getHandlers().getTrace(request, access.scope, traceId);
}
