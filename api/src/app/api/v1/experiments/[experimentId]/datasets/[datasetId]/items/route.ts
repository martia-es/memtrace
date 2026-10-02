import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toDatasetItemsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { addDatasetItemsBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lista/añade items a la ÚLTIMA versión de un dataset. Llamado tanto por el dashboard (sesión)
 * como por `memtrace.eval.MemTraceDatasetSource` y el propio script que crea el dataset (API key
 * de agente) — ver ADR-028. El SDK solo conoce un `dataset_id` plano, sin versión: esta ruta
 * resuelve "última versión" server-side (ADR-031).
 *
 * Añadir items crea automáticamente una nueva versión con bump MAJOR (ADR-032) — nunca hay que
 * crear una versión a mano. Para editar/borrar un item concreto, ver `items/[itemId]`.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const { identityRepository } = getIdentity();
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");
    const latestVersion = await identityRepository.getLatestDatasetVersion(datasetId);
    if (!latestVersion) return problem(404, "Not Found", "Dataset has no versions");

    return json(toDatasetItemsListResponse(await identityRepository.listDatasetItems(latestVersion.id)));
  });
}

/** Añade items: crea una nueva versión (bump MAJOR) atribuida a quien hace la llamada. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const { identityRepository } = getIdentity();
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const { items } = await parseJsonOrThrow(addDatasetItemsBody, request);
    const inserted = await identityRepository.addDatasetItems(
      datasetId,
      access.createdByUserId,
      items.map((i) => ({ input: i.input, expectedOutput: i.expectedOutput ?? null, metadata: (i.metadata ?? null) as Record<string, unknown> | null })),
    );
    return json(toDatasetItemsListResponse(inserted), 201);
  });
}
