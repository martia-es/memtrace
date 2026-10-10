import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { ValidationError } from "@/domain/errors";
import { getAlerts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Historial de alertas del agente, de más reciente a más antiguo. Params: `limit` (1 a 200) y `cursor`. Requiere `experiment:read`. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "experiment:read");
    if (access instanceof Response) return access;
    const q = new URL(request.url).searchParams;
    const limit = q.get("limit") ? Number(q.get("limit")) : undefined;
    if (limit !== undefined && !Number.isInteger(limit)) throw new ValidationError("Invalid limit", { limit: "Must be a whole number" });
    return json(await getAlerts().listEvents(experimentId, { limit, cursor: q.get("cursor") ?? undefined }));
  });
}
