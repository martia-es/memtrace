import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toDatasetRunSummaryDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { appendDatasetRunItemsBody } from "@/adapters/inbound/http/schemas";
import { DatasetRunClosedError } from "@/application/evaluation-service";
import { getEvaluation, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Añade un lote de resultados a un run `running` (`memtrace.eval.MemTraceResultsSink`, ADR-034).
 * Los items llevan su `itemIndex` y pueden llegar en cualquier orden; reenviarlos es idempotente; con `complete: true` el run se cierra.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; runId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId, runId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const dataset = await getIdentity().identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const { startIndex, items, complete } = await parseJsonOrThrow(appendDatasetRunItemsBody, request);
    try {
      const run = await getEvaluation().appendToDatasetRun(
        access.serviceName,
        datasetId,
        runId,
        startIndex,
        items.map((i) => ({
          itemIndex: i.itemIndex,
          input: i.input,
          expectedOutput: i.expectedOutput ?? null,
          output: i.output ?? null,
          traceId: i.traceId ?? null,
          error: i.error ?? null,
          scores: i.scores,
        })),
        complete,
      );
      if (!run) return problem(404, "Not Found", "Run not found");
      return json(toDatasetRunSummaryDto(run), 200);
    } catch (error) {
      if (error instanceof DatasetRunClosedError) return problem(409, "Conflict", error.message);
      throw error;
    }
  });
}
