import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toScoreConfigDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { updateScoreConfigBody } from "@/adapters/inbound/http/schemas";
import { getAnnotation, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Edita descripción, amplía el rango o añade categorías (ADR-036). Nombre y tipo son inmutables. Solo admin. */
export async function PATCH(request: Request, context: { params: Promise<{ experimentId: string; configId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, configId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    if (!(await getIdentity().authorizationService.can(user.id, experimentId, "scoreconfig:manage"))) {
      return problem(403, "Forbidden", "Missing permission: scoreconfig:manage");
    }
    const patch = await parseJsonOrThrow(updateScoreConfigBody, request);
    return json(toScoreConfigDto(await getAnnotation().updateScoreConfig(experimentId, configId, patch)));
  });
}
