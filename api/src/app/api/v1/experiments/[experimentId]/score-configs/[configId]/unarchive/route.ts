import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toScoreConfigDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAnnotation, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Desarchiva una score config (ADR-036). 409 si otra config activa ya usa su nombre. Solo admin. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; configId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, configId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    if (!(await getIdentity().authorizationService.can(user.id, experimentId, "scoreconfig:manage"))) {
      return problem(403, "Forbidden", "Missing permission: scoreconfig:manage");
    }
    return json(toScoreConfigDto(await getAnnotation().unarchiveScoreConfig(experimentId, configId)));
  });
}
