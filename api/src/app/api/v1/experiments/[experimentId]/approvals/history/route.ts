import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { getApprovals, getIdentity } from "@/dependency-container";
import { PromptNotFoundError } from "@/domain/errors";

export const dynamic = "force-dynamic";

/** Histórico de solicitudes de aprobación de los prompts de este experimento (ADR-076), de cualquier estado. Requiere `approval:manage`. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) throw new PromptNotFoundError("Experiment");
    return json({ items: (await getApprovals().history(experiment.organizationId, experimentId)).map(toApprovalRequestDto) });
  });
}
