import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toScoreConfigDto, toScoreConfigsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { createScoreConfigBody } from "@/adapters/inbound/http/schemas";
import { getAnnotation, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista las score configs del experimento (ADR-036). Cualquier miembro; `?includeArchived=true` incluye las archivadas. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    if (!(await getIdentity().authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return json(toScoreConfigsListResponse(await getAnnotation().listScoreConfigs(experimentId, includeArchived)));
  });
}

/** Crea una score config. Solo admin del experimento (u org_admin): la rúbrica define qué significan las etiquetas del equipo. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    if (!(await getIdentity().authorizationService.can(user.id, experimentId, "scoreconfig:manage"))) {
      return problem(403, "Forbidden", "Missing permission: scoreconfig:manage");
    }
    const body = await parseJsonOrThrow(createScoreConfigBody, request);
    return json(toScoreConfigDto(await getAnnotation().createScoreConfig(experimentId, user.id, body)), 201);
  });
}
