import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { createExperimentBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Crea un experimento (= un agente, ADR-054) dentro de una organización; requiere ser org_admin de esa organización (ADR-013). */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository } = getIdentity();
    if (!(await identityRepository.isOrgAdmin(user.id, organizationId))) {
      return problem(403, "Forbidden", "Only an org_admin can create experiments in this organization");
    }

    const { name, serviceName, description } = await parseJsonOrThrow(createExperimentBody, request);
    // un experimento es un agente (ADR-054): quien lo crea es su dueño y el catálogo de asistentes lo muestra sin más pasos
    const experiment = await identityRepository.createExperiment(organizationId, name, serviceName, { description, ownerUserId: user.id });
    // el org_admin no lee datos por su rol (ADR-052): quien crea el experimento entra como técnico para poder trabajarlo
    await identityRepository.addExperimentMember(experiment.id, user.id, "technical");
    return json(experiment, 201);
  });
}
