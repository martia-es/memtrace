import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toScoreConfigDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAnnotation, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Archiva una score config (ADR-036): sigue legible, pero deja de ofrecerse y de aceptar anotaciones nuevas. Solo admin. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; configId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, configId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    if (!(await getIdentity().authorizationService.canManageExperimentMembers(user.id, experimentId))) {
      return problem(403, "Forbidden", "Only experiment admins can manage score configs");
    }
    return json(toScoreConfigDto(await getAnnotation().archiveScoreConfig(experimentId, configId)));
  });
}
