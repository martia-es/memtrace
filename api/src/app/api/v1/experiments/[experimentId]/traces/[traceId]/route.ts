import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string; traceId: string }> }) {
  const { experimentId, traceId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  // Nota (ADR-013): el lookup por traceId es global, no filtra por service_name en la capa de datos.
  // El traceId es un identificador de alta entropía generado por el SDK, no una URL enumerable.
  return getHandlers().getTrace(request, traceId);
}
