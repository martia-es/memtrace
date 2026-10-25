import { z } from "zod";
import { ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import type { AgentSecurityDto } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { parseOrThrow, queryToObject } from "@/adapters/inbound/http/schemas";
import { getAgentSecurity } from "@/dependency-container";
import { DEFAULT_SECURITY_DAYS, MAX_SECURITY_DAYS } from "@/domain/agent-security";

export const dynamic = "force-dynamic";

const securityQuery = z.object({ days: z.coerce.number().int().min(1).max(MAX_SECURITY_DAYS).default(DEFAULT_SECURITY_DAYS) });

/**
 * Postura de seguridad del agente (ADR-103): cuántas detecciones registraron sus detectores en los últimos `days` días y cómo
 * resistieron sus últimos runs de red team. Solo cuenta y agrega; no devuelve contenido de trazas. `governance:read` o `assistant:manage`.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const { days } = parseOrThrow(securityQuery, queryToObject(new URL(request.url).searchParams));
    const posture: AgentSecurityDto = await getAgentSecurity().posture(ctx.scope, { days });
    return json(posture);
  });
}
