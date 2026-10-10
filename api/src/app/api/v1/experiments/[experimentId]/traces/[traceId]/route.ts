import { getHandlers } from "@/dependency-container";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { auditExperiment } from "@/adapters/inbound/http/audit-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; traceId: string }> }) {
  const { experimentId, traceId } = await context.params;
  const access = await requirePermission(experimentId, "experiment:read");
  if (access instanceof Response) return access;
  // quién abrió el contenido de una traza (ADR-080)
  await auditExperiment(access.user, experimentId, "trace.view", { type: "trace", id: traceId }, "view");
  // Nota (ADR-013): el lookup por traceId es global, no filtra por service_name en la capa de datos.
  // El traceId es un identificador de alta entropía generado por el SDK, no una URL enumerable.
  return getHandlers().getTrace(request, traceId);
}
