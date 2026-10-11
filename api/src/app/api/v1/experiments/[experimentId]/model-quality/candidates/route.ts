import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { ValidationError } from "@/domain/errors";
import { getModelQuality } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Los modelos con candidatos de Arena sin decidir, con todos sus candidatos, los que usa el agente primero (ADR-025).
 * `?scope=in_use` (por defecto) o `all`. Requiere `pricing:manage`.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "pricing:manage");
    if (access instanceof Response) return access;
    const scope = new URL(request.url).searchParams.get("scope") ?? "in_use";
    if (scope !== "in_use" && scope !== "all") throw new ValidationError("Invalid scope", { scope: "Use in_use or all" });
    return json({ items: await getModelQuality().candidates({ organizationId: access.organizationId, scope: access.scope }, scope) });
  });
}
