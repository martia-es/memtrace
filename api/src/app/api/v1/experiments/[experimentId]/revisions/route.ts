import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

/** Commits (versiones del código) vistos en las trazas del experimento, para elegirlos en el filtro de versión (ADR-065). */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().revisions(request, access.scope);
}
