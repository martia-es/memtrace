import { getHandlers } from "@/dependency-container";
import { requirePermission } from "@/adapters/inbound/http/auth-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requirePermission(experimentId, "trace:read_technical");
  if (access instanceof Response) return access;
  return getHandlers().listSpans(request, access.scope);
}
