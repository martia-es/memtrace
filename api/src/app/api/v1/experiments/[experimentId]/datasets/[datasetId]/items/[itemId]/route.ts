import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toDatasetItemDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { updateDatasetItemBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Edita un item de la última versión del dataset (dashboard, sesión únicamente). Crea
 * automáticamente una nueva versión con bump MINOR, atribuida a quien edita (ADR-032) — no hay
 * botón ni endpoint para crear una versión a mano.
 */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; itemId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId, itemId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.can(user.id, experimentId, "dataset:write"))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const patch = await parseJsonOrThrow(updateDatasetItemBody, request);
    const updated = await identityRepository.updateDatasetItem(datasetId, itemId, user.id, patch as { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null });
    if (!updated) return problem(404, "Not Found", "Dataset item not found in the latest version");
    return json(toDatasetItemDto(updated));
  });
}

/** Borra un item de la última versión. Crea automáticamente una nueva versión con bump MAJOR, atribuida a quien borra (ADR-032). */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; itemId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId, itemId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.can(user.id, experimentId, "dataset:write"))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    await identityRepository.deleteDatasetItem(datasetId, itemId, user.id);
    return new Response(null, { status: 204 });
  });
}
