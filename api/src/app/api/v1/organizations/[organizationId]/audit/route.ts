import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAudit, getIdentity } from "@/dependency-container";
import { isAuditAction, type AuditFilter } from "@/domain/audit";
import { ValidationError } from "@/domain/errors";

export const dynamic = "force-dynamic";

function date(value: string | null, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid date", { [field]: "Must be an ISO 8601 date" });
  return d;
}

/**
 * Registro de auditoría de la organización (ADR-080), de más reciente a más antiguo. Filtros: `from`, `to`, `action`,
 * `experimentId`, `actorUserId`; paginación con `limit` y `cursor`. Requiere `audit:read`. Solo guarda identificadores, no contenido.
 */
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "audit:read"))) {
      return problem(403, "Forbidden", "Missing permission: audit:read");
    }

    const q = new URL(request.url).searchParams;
    const action = q.get("action");
    if (action && !isAuditAction(action)) throw new ValidationError("Invalid action", { action: "Unknown audit action" });
    const filter: AuditFilter = {
      from: date(q.get("from"), "from"),
      to: date(q.get("to"), "to"),
      ...(action ? { action: action as AuditFilter["action"] } : {}),
      ...(q.get("experimentId") ? { experimentId: q.get("experimentId")! } : {}),
      ...(q.get("actorUserId") ? { actorUserId: q.get("actorUserId")! } : {}),
    };
    const limit = q.get("limit") ? Number(q.get("limit")) : undefined;
    if (limit !== undefined && !Number.isInteger(limit)) throw new ValidationError("Invalid limit", { limit: "Must be a whole number" });
    return json(await getAudit().list(organizationId, filter, { limit, cursor: q.get("cursor") ?? undefined }));
  });
}
