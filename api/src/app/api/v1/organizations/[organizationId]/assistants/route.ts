import { requireOrganizationPermission } from "@/adapters/inbound/http/auth-context";
import { toAssistantCardDto } from "@/adapters/inbound/http/assistant-mappers";
import type { AssistantCatalogResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Catálogo de asistentes de la organización (ADR-053): una ficha por experimento registrado. Solo metadatos; requiere `governance:read`. */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "governance:read");
    if (user instanceof Response) return user;
    const items = await getAssistantRegistry().listCatalog(organizationId);
    return json({ items: items.map(toAssistantCardDto) } satisfies AssistantCatalogResponse);
  });
}
