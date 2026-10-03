import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toInterAnnotatorAgreementResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { interAnnotatorAgreementQuery } from "@/adapters/inbound/http/schemas";
import { ValidationError } from "@/domain/errors";
import { getAgreement } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Acuerdo entre las personas que etiquetaron los items de una cola (ADR-040). Solo lectura; cualquier miembro. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    const parsed = interAnnotatorAgreementQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ValidationError("Invalid query", { query: parsed.error.issues[0]?.message ?? "invalid" });
    return json(toInterAnnotatorAgreementResponse(await await getAgreement().interAnnotator({ experimentId, serviceName: ctx.serviceName }, parsed.data.queueId, parsed.data.name)));
  });
}
