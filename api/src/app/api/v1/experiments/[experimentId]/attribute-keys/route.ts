import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

/** Claves de atributo vistas en los step types dados, para los selectores de "group by"/"filter by" (ADR-030). */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().attributeKeys(request, access.scope);
}
