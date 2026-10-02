import { getHandlers } from "@/dependency-container";
import { requireExperimentRead, withServiceFilter } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

/** Valores distintos de un atributo, acotados a los step types dados (ADR-027): filtro/agrupación dinámicos. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().attributeValues(withServiceFilter(request, access.serviceName));
}
