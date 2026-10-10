import { getHandlers } from "@/dependency-container";
import { requireExperimentRead } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireExperimentRead(experimentId);
  if (access instanceof Response) return access;
  return getHandlers().listTraces(request, access.scope);
}
