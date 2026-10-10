import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

/** `memtrace.step_type` distintos vistos en el rango, para el selector del builder de gráficos custom (ADR-027). */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().stepKinds(request, access.scope);
}
