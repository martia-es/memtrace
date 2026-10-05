import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toJudgeHumanAgreementResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { judgeHumanAgreementQuery } from "@/adapters/inbound/http/schemas";
import { ValidationError } from "@/domain/errors";
import { getAgreement } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Acuerdo del juez LLM con las etiquetas humanas (ADR-040) sobre un run (`datasetRunId`) o una cola (`queueId`).
 * `name` limita a un evaluador. Solo lectura; cualquier miembro.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const parsed = judgeHumanAgreementQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ValidationError("Invalid query", { query: parsed.error.issues[0]?.message ?? "invalid" });
    const { datasetRunId, queueId, name } = parsed.data;
    const scope = datasetRunId !== undefined ? { datasetRunId } : { queueId: queueId! };
    return json(toJudgeHumanAgreementResponse(await await getAgreement().judgeHuman({ experimentId, serviceName: ctx.serviceName }, scope, name)));
  });
}
