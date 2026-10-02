import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { groupAggregatesByRun, toDatasetDto, toDatasetsListResponse, type DatasetListEntry } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { createDatasetBody } from "@/adapters/inbound/http/schemas";
import { getIdentity, getScores } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lista/crea datasets de evaluación offline del experimento (ADR-028). A diferencia de los
 * gráficos custom (solo dashboard), un agente sin dashboard también necesita poder crear su
 * propio dataset — de ahí `requireExperimentAccess` en vez de `requireUser`.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const { identityRepository } = getIdentity();
    const datasets = await identityRepository.listDatasets(experimentId);

    // por dataset: sus runs (para runCount + el más reciente); un único round-trip a ClickHouse
    // agrega los "últimos run" de todos los datasets a la vez, no uno por dataset.
    const runsByDataset = await Promise.all(datasets.map((d) => identityRepository.listDatasetRuns(d.id)));
    const lastRunIds = runsByDataset.map((runs) => runs[0]?.id).filter((id): id is string => id !== undefined);
    const aggregatesByRun = groupAggregatesByRun(await getScores().aggregateForRuns(access.serviceName, lastRunIds));

    const entries: DatasetListEntry[] = datasets.map((dataset, i) => {
      const runs = runsByDataset[i]!;
      const lastRun = runs[0] ?? null;
      return { dataset, runCount: runs.length, lastRun, lastRunAggregates: lastRun ? (aggregatesByRun.get(lastRun.id) ?? []) : [] };
    });
    return json(toDatasetsListResponse(entries));
  });
}

/** Crea un dataset vacío (los items se añaden por separado). */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const { name } = await parseJsonOrThrow(createDatasetBody, request);
    const { identityRepository } = getIdentity();
    const dataset = await identityRepository.createDataset(experimentId, access.createdByUserId, name);
    return json(toDatasetDto(dataset, 0, null), 201);
  });
}
