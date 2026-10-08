import { requireOrganizationPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import type { PromptListResponse } from "@/adapters/inbound/http/contract";
import { toPromptDetailDto, toPromptSummaryDto } from "@/adapters/inbound/http/prompt-mappers";
import { createPromptBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Prompts de la organización (ADR-067). `?experimentId=` filtra por agente, `?archived=true` incluye los archivados. Requiere `prompt:read` de organización. */
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "prompt:read");
    if (user instanceof Response) return user;
    const params = new URL(request.url).searchParams;
    const items = await getPrompts().list(organizationId, { experimentId: params.get("experimentId") ?? undefined, includeArchived: params.get("archived") === "true" });
    return json({ items: items.map(toPromptSummaryDto) } satisfies PromptListResponse);
  });
}

/** Crea un prompt con su versión 1. Requiere `prompt:write` de organización; quien tenga el rol técnico de un agente lo crea desde `/experiments/{id}/prompts`. */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "prompt:write");
    if (user instanceof Response) return user;
    const body = await parseJsonOrThrow(createPromptBody, request);
    return json(toPromptDetailDto(await getPrompts().create(organizationId, user.id, body)), 201);
  });
}
