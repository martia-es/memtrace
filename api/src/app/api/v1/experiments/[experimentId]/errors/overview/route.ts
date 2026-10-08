import { getHandlers } from "@/dependency-container";
import { requireExperimentRead, withServiceFilter } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

/** Errores del rango en lenguaje de negocio (ADR-066): legible para perfiles no técnicos con acceso de lectura. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().errorOverview(withServiceFilter(request, access.serviceName));
}
