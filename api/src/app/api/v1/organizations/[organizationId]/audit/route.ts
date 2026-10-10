import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { AUDIT_ACTIONS } from "@/domain/audit";
import { ValidationError } from "@/domain/errors";
import { getAudit } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Registro de auditoría de la organización (ADR-082): quién concedió o quitó acceso, claves de agente y los accesos de
 * consultoras a vuestros datos. Solo org_admin. Los más recientes primero; `before` (ISO) pagina hacia atrás.
 */
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const params = new URL(request.url).searchParams;
    const action = params.get("action") ?? undefined;
    if (action && !(AUDIT_ACTIONS as readonly string[]).includes(action)) throw new ValidationError("Invalid action", { action: `one of ${AUDIT_ACTIONS.join(", ")}` });
    const before = params.get("before") ?? undefined;
    if (before && Number.isNaN(Date.parse(before))) throw new ValidationError("Invalid before", { before: "must be an ISO date" });
    const limit = Number(params.get("limit") ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ValidationError("Invalid limit", { limit: "must be an integer between 1 and 500" });
    const items = await getAudit().listForOrganization(organizationId, { limit, before, action });
    return json({ items, nextBefore: items.length === limit ? items[items.length - 1]!.at : null });
  });
}
