import { tenantOf } from "@/domain/tenant";
import type { AnnotationQueueRepository } from "@/application/ports/annotation-queue-repository";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { JudgeScoreRow, ScoreRepository } from "@/application/ports/score-repository";
import {
  computeInterAnnotator,
  computeJudgeHuman,
  emptyJudgeHumanMetric,
  type HumanLabel,
  type InterAnnotatorMetric,
  type JudgeHumanMetric,
  type JudgeLabel,
} from "@/domain/agreement";
import type { Annotation } from "@/domain/annotation";
import type { QueueItem } from "@/domain/annotation-queue";
import { AnnotationQueueNotFoundError, DatasetRunNotFoundError } from "@/domain/errors";
import type { ScoreDataType, ScoreJudge } from "@/domain/evaluation";

/** Items de una cola que se consideran al medir acuerdo (ADR-040): por encima, la métrica no es ya de "una cola revisable". */
const MAX_QUEUE_ITEMS = 5000;

export interface AgreementActor {
  experimentId: string;
  /** clave de tenant de ClickHouse */
  serviceName: string;
}

export type JudgeHumanScope = { datasetRunId: string } | { queueId: string };

export interface JudgeHumanMetricResult extends JudgeHumanMetric {
  /** Identidad del juez de este evaluador; `null` si no se registró (scores anteriores a ADR-043) o si hay varias (`mixed_judges`). */
  judge: ScoreJudge | null;
  /** Todas las identidades vistas; más de una = `status: "mixed_judges"`. */
  judges: ScoreJudge[];
}

export interface JudgeHumanResult {
  scope: {
    type: "run" | "queue";
    id: string;
    /** objetivos de tipo traza de la cola, no emparejables con el juez */
    traceTargets: number;
    /** Solo en colas: cómo se eligieron sus items de run, para juzgar si la muestra es representativa (ADR-040). */
    population?: { manual: number; filter: number; randomSample: number };
  };
  metrics: JudgeHumanMetricResult[];
  /** Nombres que existen en un solo lado y por eso no se pueden emparejar (ADR-040: "name your human rubric like your evaluator"). */
  unmatched: { judgeOnly: string[]; humanOnly: string[] };
}

export interface InterAnnotatorResult {
  scope: { type: "queue"; id: string };
  metrics: InterAnnotatorMetric[];
}

/**
 * Acuerdo juez-humano e inter-anotador (ADR-040). Solo lectura: trae las dos mitades con consultas acotadas a un
 * run o a una cola y delega todo el cálculo en `domain/agreement.ts`.
 */
export class AgreementService {
  constructor(
    private readonly identity: Pick<IdentityRepository, "listRunsForExperiment">,
    private readonly scores: Pick<ScoreRepository, "listJudgeScoresForRuns">,
    private readonly annotations: Pick<AnnotationRepository, "listForRuns" | "listForTraces">,
    private readonly queues: Pick<AnnotationQueueRepository, "get" | "listItems">,
  ) {}

  async judgeHuman(actor: AgreementActor, scope: JudgeHumanScope, name?: string): Promise<JudgeHumanResult> {
    let runIds: string[];
    let allowed: Set<string> | null = null;
    let configIds: Set<string> | null = null;
    let traceTargets = 0;
    let scopeInfo: Pick<JudgeHumanResult["scope"], "type" | "id" | "population">;

    if ("datasetRunId" in scope) {
      const runs = await this.identity.listRunsForExperiment(actor.experimentId);
      if (!runs.some((r) => r.id === scope.datasetRunId)) throw new DatasetRunNotFoundError(scope.datasetRunId);
      runIds = [scope.datasetRunId];
      scopeInfo = { type: "run", id: scope.datasetRunId };
    } else {
      const queue = await this.queues.get(actor.experimentId, scope.queueId);
      if (!queue) throw new AnnotationQueueNotFoundError(scope.queueId);
      const items = await this.queues.listItems(queue.id, undefined, MAX_QUEUE_ITEMS);
      const runItems = items.filter(isRunItem);
      traceTargets = items.length - runItems.length;
      allowed = new Set(runItems.map((i) => runKey(i.datasetRunId, i.itemIndex)));
      configIds = new Set(queue.rubric.map((r) => r.configId));
      runIds = [...new Set(runItems.map((i) => i.datasetRunId))];
      scopeInfo = {
        type: "queue",
        id: queue.id,
        population: {
          manual: runItems.filter((i) => i.population === "manual").length,
          filter: runItems.filter((i) => i.population === "filter").length,
          randomSample: runItems.filter((i) => i.population === "random_sample").length,
        },
      };
    }

    const [judgeRows, annotations] = await Promise.all([
      this.scores.listJudgeScoresForRuns(tenantOf(actor), runIds, name),
      this.annotations.listForRuns(tenantOf(actor), runIds, name),
    ]);
    const inScope = (run: string, index: number) => allowed === null || allowed.has(runKey(run, index));
    const judge = judgeRows.filter((r) => inScope(r.datasetRunId, r.itemIndex));
    const human = annotations.filter((a) => a.datasetRunId != null && a.itemIndex != null && inScope(a.datasetRunId, a.itemIndex) && (configIds === null || configIds.has(a.configId)));

    const judgeByName = groupBy(judge, (r) => r.name);
    const humanByName = groupBy(human, (a) => a.configName);
    const metrics: JudgeHumanMetricResult[] = [];
    for (const [metricName, judgeGroup] of judgeByName) {
      const humanGroup = humanByName.get(metricName);
      if (humanGroup) metrics.push(this.judgeHumanMetric(metricName, judgeGroup, humanGroup));
    }
    metrics.sort((a, b) => a.name.localeCompare(b.name));

    return {
      scope: { ...scopeInfo, traceTargets },
      metrics,
      unmatched: {
        judgeOnly: [...judgeByName.keys()].filter((n) => !humanByName.has(n)).sort(),
        humanOnly: [...humanByName.keys()].filter((n) => !judgeByName.has(n)).sort(),
      },
    };
  }

  async interAnnotator(actor: AgreementActor, queueId: string, name?: string): Promise<InterAnnotatorResult> {
    const queue = await this.queues.get(actor.experimentId, queueId);
    if (!queue) throw new AnnotationQueueNotFoundError(queueId);
    const items = await this.queues.listItems(queue.id, undefined, MAX_QUEUE_ITEMS);
    const runItems = items.filter(isRunItem);
    const allowedRunItems = new Set(runItems.map((i) => runKey(i.datasetRunId, i.itemIndex)));
    const traceIds = [...new Set(items.filter((i) => i.targetType === "trace" && i.traceId).map((i) => i.traceId!))];
    const configIds = new Set(queue.rubric.map((r) => r.configId));

    const [runLabels, traceLabels] = await Promise.all([
      this.annotations.listForRuns(tenantOf(actor), [...new Set(runItems.map((i) => i.datasetRunId))], name),
      this.annotations.listForTraces(tenantOf(actor), traceIds, name),
    ]);
    const labels = [
      ...runLabels.filter((a) => a.datasetRunId != null && a.itemIndex != null && allowedRunItems.has(runKey(a.datasetRunId, a.itemIndex))),
      ...traceLabels,
    ].filter((a) => configIds.has(a.configId));

    const metrics: InterAnnotatorMetric[] = [];
    for (const [metricName, group] of groupBy(labels, (a) => a.configName)) {
      const types = new Set(group.map((a) => a.dataType));
      // Una config archivada y otra con el mismo nombre pero otro tipo no son comparables: se mide cada tipo por separado.
      for (const dataType of types) {
        metrics.push(computeInterAnnotator({ name: metricName, dataType, labels: group.filter((a) => a.dataType === dataType).map(toHumanLabel) }));
      }
    }
    metrics.sort((a, b) => a.name.localeCompare(b.name));
    return { scope: { type: "queue", id: queue.id }, metrics };
  }

  private judgeHumanMetric(name: string, judgeRows: JudgeScoreRow[], humanRows: Annotation[]): JudgeHumanMetricResult {
    const judges = distinctJudges(judgeRows);
    const judgeTypes = new Set(judgeRows.map((r) => r.dataType));
    const humanTypes = new Set(humanRows.map((a) => a.dataType));
    const judgeType = judgeRows[0]!.dataType;

    // Mezclar jueces promediaría dos instrumentos distintos en un solo número: se avisa en lugar de calcularlo.
    if (judges.length > 1) {
      return { ...emptyJudgeHumanMetric(name, judgeType, "mixed_judges", `scores of this evaluator come from ${judges.length} different judge identities`), judge: null, judges };
    }
    const judge = judges[0] ?? null;
    if (judgeTypes.size > 1 || humanTypes.size > 1) {
      return { ...emptyJudgeHumanMetric(name, judgeType, "incomparable", "the data type of this name is not consistent within one side"), judge, judges };
    }
    const metric = computeJudgeHuman({
      name,
      judgeDataType: judgeType,
      humanDataType: humanRows[0]!.dataType as ScoreDataType,
      judge: judgeRows.map<JudgeLabel>((r) => ({ target: runKey(r.datasetRunId, r.itemIndex), value: r.value })),
      human: humanRows.map(toHumanLabel),
    });
    return { ...metric, judge, judges };
  }
}

/** Clave de objetivo `run:<id>:<índice>`; el `target` de los desacuerdos la devuelve tal cual para que la UI enlace al item. */
export function runKey(datasetRunId: string, itemIndex: number): string {
  return `run:${datasetRunId}:${itemIndex}`;
}

function toHumanLabel(a: Annotation): HumanLabel {
  const target = a.datasetRunId != null && a.itemIndex != null ? runKey(a.datasetRunId, a.itemIndex) : `trace:${a.traceId}`;
  return { target, annotatorId: a.annotatorId, value: a.value };
}

function isRunItem(item: QueueItem): item is QueueItem & { datasetRunId: string; itemIndex: number } {
  return item.targetType === "run_item" && item.datasetRunId !== null && item.itemIndex !== null;
}

function distinctJudges(rows: JudgeScoreRow[]): ScoreJudge[] {
  const seen = new Map<string, ScoreJudge>();
  for (const r of rows) seen.set(`${r.judgeModel ?? ""}\u0000${r.judgePromptHash ?? ""}`, { model: r.judgeModel, promptHash: r.judgePromptHash });
  return [...seen.values()];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
