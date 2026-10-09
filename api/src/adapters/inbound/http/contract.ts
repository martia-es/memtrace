/**
 * Contrato HTTP/JSON de `/api/v1` (ADR-009). Es lo único que conoce el dashboard.
 * Solo se admiten cambios aditivos dentro de una versión.
 *
 * AUTOCONTENIDO a propósito: no importa nada del resto de la API, porque el dashboard lo importa
 * (solo tipos) desde `dashboard/` con un alias. Los tipos del dominio encajan estructuralmente.
 */

export type StatusCodeDto = "ok" | "error" | "unset";

export interface SpanStatusDto {
  code: StatusCodeDto;
  message: string | null;
}

export interface GenAiInfoDto {
  operation: string | null;
  provider: string | null;
  requestModel: string | null;
  responseModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  finishReasons: string[];
  temperature: number | null;
  maxTokens: number | null;
  toolName: string | null;
  toolCallId: string | null;
}

/** JSON parseado, o el string original si lo capturado no era JSON (ADR-004). */
export interface SpanContentDto {
  inputMessages?: unknown;
  outputMessages?: unknown;
  toolArguments?: unknown;
  toolResult?: unknown;
  input?: unknown;
  output?: unknown;
}

/** Versión de un prompt del registro que usó una traza o conversación (ADR-068). */
export interface PromptRefDto {
  name: string;
  version: number;
}

export interface TraceSummaryDto {
  traceId: string;
  /** versiones de prompt del registro que usó la traza */
  prompts: PromptRefDto[];
  rootSpanName: string;
  serviceName: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  /** vista previa (≤ 240 caracteres) del mensaje de entrada y de salida */
  input: string | null;
  output: string | null;
  /** mensaje de error del span raíz (≤ 240 caracteres) cuando la traza falló; `output` va vacío si el agente no llegó a responder */
  error: string | null;
  /** conversación a la que pertenece el turno (ADR-012) */
  conversationId: string | null;
  /** commit del código que generó la traza (ADR-065); null = versión desconocida */
  revision: string | null;
}

export interface TraceListResponse {
  items: TraceSummaryDto[];
  nextCursor: string | null;
}

/** Un span suelto del listado plano, con una vista previa (≤ 240 caracteres) de su entrada y salida. */
export interface SpanRowDto {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  conversationId: string | null;
  name: string;
  /** llm | tool | retriever | agent | chain | embedding | unknown */
  kind: string;
  serviceName: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  model: string | null;
  /** null si el span no es una llamada a un LLM */
  totalTokens: number | null;
  /** null si el span no es una llamada a un LLM, o no hay precio conocido para su modelo (ADR-025) */
  costUsd: number | null;
  input: string | null;
  output: string | null;
}

export interface SpanListResponse {
  items: SpanRowDto[];
  nextCursor: string | null;
}

export interface SpanEventDto {
  name: string;
  time: string;
  attributes: Record<string, string>;
}

export interface SpanNodeDto {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  serviceName: string;
  startTime: string;
  offsetMs: number;
  durationMs: number;
  status: SpanStatusDto;
  orphan: boolean;
  genAi: GenAiInfoDto | null;
  /** null si el span no es una llamada a un LLM, o no hay precio conocido para su modelo (ADR-025) */
  costUsd: number | null;
  content: SpanContentDto | null;
  framework: string | null;
  attributes: Record<string, string>;
  events: SpanEventDto[];
  children: SpanNodeDto[];
}

export interface TraceDetailResponse {
  traceId: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  /** 0 si ningún span tiene precio conocido para su modelo, no "sin datos" (ADR-025) */
  totalCostUsd: number;
  truncated: boolean;
  conversationId: string | null;
  revision: string | null;
  framework: string | null;
  roots: SpanNodeDto[];
}

/** Conversación = trazas (turnos) con el mismo `gen_ai.conversation.id` (ADR-012). */
export interface ConversationSummaryDto {
  conversationId: string;
  /** versiones de prompt del registro que usó algún turno */
  prompts: PromptRefDto[];
  serviceNames: string[];
  startTime: string;
  lastActivity: string;
  turnCount: number;
  /** turnos cuyo span raíz falló */
  errorTurns: number;
  /** spans fallidos en cualquier punto de la conversación */
  failedSpans: number;
  totalTokens: number;
  /** suma de las duraciones de los turnos (sin esperas del usuario) */
  activeMs: number;
  /** el primer mensaje del usuario (≤ 120 caracteres); null si el agente no capturó contenido (ADR-049) */
  title: string | null;
  /** null si ningún modelo de la conversación tiene precio conocido (ADR-025) */
  costUsd: number | null;
}

/** Mensajes de la conversación por turno; vacío si el agente no capturó contenido (ADR-013). */
export interface TranscriptResponse {
  conversationId: string;
  contentCaptured: boolean;
  truncated: boolean;
  turns: { traceId: string; startTime: string; model: string | null; user: string | null; assistant: string | null }[];
}

export interface ConversationListResponse {
  items: ConversationSummaryDto[];
  nextCursor: string | null;
}

/** Resumen + turnos en orden cronológico */
export interface ConversationDetailResponse extends ConversationSummaryDto {
  turns: TraceListResponse;
}

/** Árbol de spans de cada turno de la conversación, en orden cronológico (para la vista unificada). */
export interface ConversationTreeResponse {
  items: TraceDetailResponse[];
  nextCursor: string | null;
}

export interface OverviewResponse {
  range: { from: string; to: string; bucketSeconds: number };
  totals: {
    traces: number;
    spans: number;
    conversations: number;
    errorTraces: number;
    errorRate: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** 0 si ningún modelo usado tiene precio conocido, no "sin datos" (ADR-025) */
    costUsd: number;
  };
  latencyMs: { p50: number; p95: number; p99: number };
  timeseries: { bucketStart: string; traces: number; errorTraces: number; p95Ms: number; totalTokens: number }[];
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; p95Ms: number; costUsd: number | null }[];
  byTool: { tool: string; calls: number; errors: number; p95Ms: number; mcpServer?: string | null }[];
  /** vacío si el worker de temáticas (ADR-022) aún no ha corrido sobre este rango */
  byTopic: { topic: string; responses: number; avgConfidence: number }[];
}

/** Errores en lenguaje de negocio, agrupados por categoría (ADR-066). */
export interface ErrorCategoryDto {
  id: string;
  title: string;
  explanation: string;
  action: string;
  severity: "high" | "medium" | "low";
  occurrences: number;
  previousOccurrences: number;
  traces: number;
  conversations: number;
  firstSeen: string;
  lastSeen: string;
  affected: { kind: string; name: string; occurrences: number }[];
  /** mensaje técnico más frecuente, normalizado */
  sample: string;
}

export interface ErrorOverviewResponse {
  range: { from: string; to: string };
  /** null si el periodo anterior queda fuera de la retención */
  previousRange: { from: string; to: string } | null;
  totals: {
    occurrences: number;
    tracesWithErrors: number;
    conversationsWithErrors: number;
    totalTraces: number;
    totalConversations: number;
  };
  categories: ErrorCategoryDto[];
}

/** Versiones del código (commits) vistas en trazas (ADR-065). */
export interface RevisionDto {
  revision: string;
  traces: number;
  lastSeen: string;
}

export interface RevisionsResponse {
  items: RevisionDto[];
}

export interface ServicesResponse {
  items: string[];
}

/** Tokens totales por experimento accesible al usuario, para la comparativa de coste entre agentes. */
export interface ExperimentUsageResponse {
  items: { experimentId: string; experimentName: string; traces: number; inputTokens: number; outputTokens: number; totalTokens: number }[];
}

/** Precio de un modelo, sincronizado desde LiteLLM (ADR-025). */
export interface ModelPricingDto {
  modelId: string;
  provider: string;
  inputPricePerToken: number;
  outputPricePerToken: number;
  source: string;
  updatedAt: string;
}

export interface ModelPricingResponse {
  items: ModelPricingDto[];
}

// ----- Custom metrics sobre spans definidos por el usuario (ADR-027) -----

export interface StepKindDto {
  stepType: string;
  count: number;
}

export interface StepKindsResponse {
  items: StepKindDto[];
}

export interface AttributeValueDto {
  value: string;
  count: number;
}

export interface AttributeValuesResponse {
  items: AttributeValueDto[];
}

/** Clave de atributo vista en los step types elegidos (ADR-030). */
export interface AttributeKeyDto {
  key: string;
  count: number;
}

export interface AttributeKeysResponse {
  items: AttributeKeyDto[];
}

export type CustomMetricTypeDto = "count" | "avg_duration" | "p50_duration" | "p95_duration" | "error_rate";
export type CustomChartTypeDto = "bar" | "pie" | "line" | "area" | "number" | "table";

export interface CustomMetricFilterDto {
  attribute: string;
  values: string[];
}

/** Forma cerrada y declarativa de un gráfico custom: nunca SQL, ver ADR-027. */
export interface CustomMetricDefinitionDto {
  chartType: CustomChartTypeDto;
  stepTypes: string[];
  metric: CustomMetricTypeDto;
  groupByAttribute: string | null;
  filters: CustomMetricFilterDto[];
}

export interface CustomMetricPointDto {
  label: string;
  value: number;
}

export interface CustomMetricBucketDto {
  bucketStart: string;
  points: CustomMetricPointDto[];
}

/** `points`: resultado agregado (bar/pie/number). `timeseries`: solo cuando chartType es "line". */
export interface CustomMetricResultResponse {
  points: CustomMetricPointDto[];
  timeseries: CustomMetricBucketDto[];
}

export interface SavedCustomMetricDto {
  id: string;
  name: string;
  definition: CustomMetricDefinitionDto;
  createdAt: string;
}

export interface CustomMetricsListResponse {
  items: SavedCustomMetricDto[];
}

/** Informe guardado (ADR-033): varias custom_metrics en un grid de 12 columnas. */
export interface MetricReportChartDto {
  customMetricId: string;
  name: string;
  definition: CustomMetricDefinitionDto;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MetricReportSummaryDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricReportDto extends MetricReportSummaryDto {
  charts: MetricReportChartDto[];
}

export interface MetricReportsListResponse {
  items: MetricReportSummaryDto[];
}

/** Evaluación offline (ADR-028). */

/** Identidad de un juez `llm_judge` (ADR-043); `null` = no registrada (score anterior o cliente sin modelo). */
export interface ScoreJudgeDto {
  model: string | null;
  promptHash: string | null;
}

export interface ScoreAggregateDto {
  name: string;
  dataType: ScoreDataTypeDto;
  /** solo si `dataType === "boolean"`: fracción (0-1) de scores con valor `"true"` */
  passRate: number | null;
  /** solo si `dataType === "numeric"`: media del valor */
  average: number | null;
  count: number;
  /** Jueces distintos que produjeron este agregado (ADR-043); vacío si no es `llm_judge`. Más de uno = mezcla. */
  judges: ScoreJudgeDto[];
}

export interface DatasetLastRunDto {
  id: string;
  name: string;
  createdAt: string;
  itemCount: number;
  aggregates: ScoreAggregateDto[];
}

export interface DatasetDto {
  id: string;
  name: string;
  createdAt: string;
  runCount: number;
  versionCount: number;
  latestVersionMajor: number;
  latestVersionMinor: number;
  lastRun: DatasetLastRunDto | null;
}

export interface DatasetsListResponse {
  items: DatasetDto[];
}

/** Una foto fija de items de un dataset (ADR-031/ADR-032): se crea sola en cada cambio de item,
 * nunca a mano — `note` describe automáticamente qué cambió y quién (ver `createdByEmail`). */
export interface DatasetVersionDto {
  id: string;
  major: number;
  minor: number;
  note: string | null;
  createdByEmail: string;
  createdAt: string;
  itemCount: number;
  /** Cambios reales frente a la versión inmediatamente anterior (ADR-033); 0/0/0 en la primera. */
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

export interface DatasetVersionsListResponse {
  items: DatasetVersionDto[];
}

export interface DatasetItemDto {
  id: string;
  datasetVersionId: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: Record<string, unknown> | null;
  createdByEmail: string;
  createdAt: string;
  updatedByEmail: string | null;
  updatedAt: string | null;
  /** Si no es null, este item es un tombstone: se borró en esta versión (ADR-032 follow-up). */
  deletedByEmail: string | null;
  deletedAt: string | null;
}

export type DatasetItemChangeKindDto = "added" | "modified" | "removed";

/** `removed.after` es el tombstone si el borrado ocurrió en la versión comparada (trae quién/cuándo). */
export interface DatasetItemChangeDto {
  originItemId: string;
  kind: DatasetItemChangeKindDto;
  before: DatasetItemDto | null;
  after: DatasetItemDto | null;
}

export interface DatasetVersionRefDto {
  id: string;
  major: number;
  minor: number;
}

/** Diff de `base` (la versión de referencia, o null si no hay anterior) a `target` (ADR-033). */
export interface DatasetVersionDiffResponse {
  base: DatasetVersionRefDto | null;
  target: DatasetVersionRefDto;
  unchangedCount: number;
  changes: DatasetItemChangeDto[];
}

export interface DatasetItemsListResponse {
  items: DatasetItemDto[];
  /** La versión de la que salen `items` (resuelta server-side si se pidió la última): el SDK la registra en el run (ADR-034). */
  version?: DatasetVersionRefDto;
}

/** ADR-038. `input` (opcional) sustituye al extraído de la traza. `expectedOutput` explícito gana sobre `fromConfigId` (etiqueta categórica de las anotaciones de la traza). */
export interface PromoteTracesBody {
  items: Array<{ traceId: string; input?: unknown; expectedOutput?: unknown; fromConfigId?: string; /** usa la respuesta del agente que se revisó como expectedOutput (ADR-061) */ useObservedOutput?: boolean; /** cola de la que sale, para dejarlo en `promotedFrom` */ queueId?: string }>;
}

export type PromotionSkipReasonDto = "already_promoted" | "no_content" | "not_found" | "ambiguous_label" | "unsupported_label";

export interface PromoteTracesResponse {
  added: DatasetItemDto[];
  skipped: Array<{ traceId: string; reason: PromotionSkipReasonDto }>;
  /** La versión creada; null si no se añadió ningún item (no se crea versión). */
  version: DatasetVersionRefDto | null;
}

export interface UpdateDatasetItemBody {
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown> | null;
}

/** Sesión de edición publicada de golpe: una sola versión nueva (ADR-041). `update[].id` / `remove[]` son ids de fila de la última versión. */
export interface CommitDatasetChangesBody {
  add?: Array<{ input: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }>;
  update?: Array<UpdateDatasetItemBody & { id: string }>;
  remove?: string[];
}

export type ScoreDataTypeDto = "numeric" | "boolean" | "categorical";
export type ScoreSourceDto = "human" | "code" | "llm_judge";

export interface ScoreDto {
  name: string;
  value: string;
  dataType: ScoreDataTypeDto;
  source: ScoreSourceDto;
  comment: string | null;
  /** Solo en `llm_judge` (ADR-043): modelo que juzgó y huella de la rúbrica. */
  judgeModel?: string | null;
  judgePromptHash?: string | null;
}

/** Una fila tal como la sube el SDK (`memtrace.eval`, ver `eval_api_client.py`). */
export interface DatasetRunItemSubmissionDto {
  input: unknown;
  expectedOutput: unknown;
  output: unknown;
  traceId: string | null;
  error: string | null;
  scores: ScoreDto[];
}

export interface SubmitDatasetRunBody {
  name: string;
  items: DatasetRunItemSubmissionDto[];
}

export interface DatasetRunSummaryDto {
  id: string;
  name: string;
  versionMajor: number;
  versionMinor: number;
  itemCount: number;
  /** `running` mientras el SDK sigue subiendo lotes (o si el proceso murió a medias), ADR-034. */
  status: "running" | "completed";
  createdAt: string;
  /** commit del código que se evaluó (ADR-065); null = versión desconocida */
  revision: string | null;
  /** el árbol tenía cambios sin commitear; null = no se sabe */
  revisionDirty: boolean | null;
  aggregates: ScoreAggregateDto[];
}

export interface DatasetRunsListResponse {
  items: DatasetRunSummaryDto[];
}

/** Una fila de la vista global "Runs" (ADR-031): un run de cualquier dataset del experimento. */
export interface RunListItemDto extends DatasetRunSummaryDto {
  datasetId: string;
  datasetName: string;
}

export interface RunsListResponse {
  items: RunListItemDto[];
}

/** Latencia, tokens y coste de un item, leídos de su traza al consultar (ADR-044); no se guardan con el item. */
export interface ItemTelemetryDto {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** null si ningún modelo de la traza tiene precio conocido */
  costUsd: number | null;
  /** versiones de prompt del registro con las que se produjo el item */
  prompts: PromptRefDto[];
}

export interface DatasetRunItemResultDto extends DatasetRunItemSubmissionDto {
  itemIndex: number;
  /** null si el item no tiene traza, o su traza no está (aún) en el almacén o ya expiró */
  telemetry: ItemTelemetryDto | null;
}

export interface DatasetRunDetailResponse {
  dataset: { id: string; name: string };
  run: DatasetRunSummaryDto;
  items: DatasetRunItemResultDto[];
}

/** Score config (ADR-036): rúbrica de un experimento. `minValue`/`maxValue` solo en numeric; `categories` solo en categorical. */
export interface ScoreConfigCategoryDto {
  label: string;
  value: number | null;
}

export interface ScoreConfigDto {
  id: string;
  name: string;
  dataType: "numeric" | "boolean" | "categorical";
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreConfigCategoryDto[] | null;
  /** Solo boolean: objetivo de pass rate (0-1); null = valor por defecto del dashboard. */
  targetPassRate: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ScoreConfigsListResponse {
  items: ScoreConfigDto[];
}

/** Anotación humana sobre una traza (ADR-037). `annotator.name` es null si el usuario ya no existe ("former member"). */
export interface AnnotationDto {
  configId: string;
  configName: string;
  dataType: "numeric" | "boolean" | "categorical";
  value: string;
  comment: string | null;
  /** null = la traza entera */
  spanId: string | null;
  annotator: { id: string; name: string | null };
  createdAt: string;
}

/** Score automático (`code`/`llm_judge`) de la misma traza, mostrado junto a las anotaciones. */
export interface TraceScoreDto {
  datasetRunId: string;
  itemIndex: number;
  name: string;
  value: string;
  dataType: "numeric" | "boolean" | "categorical";
  source: string;
  comment: string | null;
}

/** Trazas con alguna valoración humana baja en el rango (ADR-049). */
export interface LowRatedResponse {
  count: number;
  items: Array<{ traceId: string; configName: string; value: string; createdAt: string }>;
}

/** Voto de feedback de usuario final (ADR-062). */
export interface UserFeedbackDto {
  rating: 1 | -1;
  comment: string | null;
  spanId: string | null;
  endUserId: string | null;
  externalMessageId: string | null;
  createdAt: string;
}

/** Votos de una traza y si coinciden con la revisión humana. */
export interface TraceFeedbackResponse {
  votes: UserFeedbackDto[];
  alignment: "aligned" | "misaligned" | "unknown";
}

/** Votos de las trazas o conversaciones pedidas; solo las que tienen alguno. */
export interface FeedbackRatingsResponse {
  items: Array<{ id: string; up: number; down: number }>;
}

/** Métricas de feedback del rango: totales, serie diaria, alineación y últimas trazas con 👎. */
export interface FeedbackOverviewResponse {
  summary: { total: number; up: number; down: number; satisfaction: number | null; ratedTraces: number };
  days: Array<{ day: string; up: number; down: number }>;
  alignment: { aligned: number; misaligned: number };
  recentDown: Array<{ traceId: string; comment: string | null; createdAt: string }>;
}

/** Estado de anotación de las trazas o conversaciones pedidas; solo las que tienen alguna etiqueta humana. */
export interface AnnotationRatingsResponse {
  items: Array<{ id: string; labels: number; low: boolean }>;
}

export interface TraceAnnotationsResponse {
  annotations: AnnotationDto[];
  scores: TraceScoreDto[];
}

/** Cola de anotación (ADR-039). `rubric` referencia score configs por id; el detalle trae además sus definiciones. */
export interface AnnotationQueueDto {
  id: string;
  name: string;
  instructions: string | null;
  requiredAnnotations: number;
  /** Personas autorizadas a anotar (ADR-046). */
  reviewerIds: string[];
  rubric: Array<{ configId: string; required: boolean }>;
  createdAt: string;
  archivedAt: string | null;
}

export interface QueueProgressDto {
  pending: number;
  completed: number;
  skipped: number;
}

export interface AnnotationQueueSummaryDto extends AnnotationQueueDto {
  progress: QueueProgressDto;
}

/** Persona que puede anotar en una cola: lo justo para mostrar su avatar y su nombre. */
export interface AssignedReviewerDto {
  userId: string;
  name: string | null;
  image: string | null;
}

export interface AnnotationQueueListItemDto extends AnnotationQueueSummaryDto {
  /** items terminados por los revisores que aún no están en ningún dataset (trabajo pendiente del perfil técnico) */
  toCurate: number;
  assignedReviewers: AssignedReviewerDto[];
  /** ¿puede quien consulta anotar en esta cola? Si no, el botón Review no se ofrece (ADR-051). */
  isReviewer: boolean;
}

export interface ReviewerCandidatesResponse {
  candidates: Array<{ userId: string; name: string | null; email: string }>;
}

export interface AnnotationQueuesListResponse {
  items: AnnotationQueueListItemDto[];
}

export interface AnnotationQueueDetailResponse extends AnnotationQueueSummaryDto {
  configs: ScoreConfigDto[];
  reviewers: Array<{ userId: string; name: string | null; completed: number; skipped: number; inProgress: number }>;
}

export interface QueueItemDto {
  id: string;
  targetType: "trace" | "run_item";
  traceId: string | null;
  datasetRunId: string | null;
  itemIndex: number | null;
  status: "pending" | "completed" | "skipped";
  /** Cómo se eligió el item (ADR-040): a mano, por filtro/run completo o por muestreo aleatorio. */
  population: "manual" | "filter" | "random_sample";
  addedAt: string;
  completedAt: string | null;
}

export interface QueueItemsResponse {
  items: QueueItemDto[];
}

export interface AddQueueItemsResponse {
  added: number;
  duplicates: number;
  /** Solo con muestreo: la semilla usada (para reproducir la muestra) y de cuántos candidatos se eligió. */
  sample?: { seed: string; size: number; poolSize: number; /** había más candidatos que el tope; la muestra sale solo de los más recientes */ truncated: boolean };
}

/** `item` es null cuando no queda nada para este revisor. */
export interface NextQueueItemResponse {
  item: QueueItemDto | null;
}

/** Qué respondió un revisor en un criterio (ADR-050). `isReviewer` es false si ya no está en la lista de la cola. */
export interface QueueResultLabelDto {
  userId: string;
  name: string | null;
  value: string;
  comment: string | null;
  createdAt: string;
  isReviewer: boolean;
}

/** Decisión del técnico sobre un criterio de un item; no modifica las etiquetas de los revisores. */
export interface QueueResolutionDto {
  value: string;
  expectedOutput: string | null;
  resolvedBy: string;
  resolvedAt: string;
}

export interface QueueResultCriterionDto {
  configId: string;
  status: "no_labels" | "consensus" | "disagreement";
  labels: QueueResultLabelDto[];
  resolution: QueueResolutionDto | null;
}

/** Dataset (última versión) que ya contiene un item promovido desde la traza. */
export interface PromotedToDto {
  datasetId: string;
  datasetName: string;
  version: string;
}

export interface QueueResultItemDto extends QueueItemDto {
  criteria: QueueResultCriterionDto[];
  promotedTo: PromotedToDto[];
  /** algún criterio con desacuerdo y sin resolver */
  needsResolution: boolean;
}

/** Cola que contiene una traza, con el estado del item (ADR-050). */
export interface TraceQueueDto {
  queueId: string;
  queueName: string;
  archived: boolean;
  itemStatus: "pending" | "completed" | "skipped";
}

export interface TraceQueuesResponse {
  items: TraceQueueDto[];
}

/** Resultados de una cola para el perfil técnico (ADR-050). Solo admin. */
export interface QueueResultsResponse {
  configs: ScoreConfigDto[];
  total: number;
  items: QueueResultItemDto[];
}

export interface ResolveQueueItemBody {
  value: string | number | boolean;
  expectedOutput?: string | null;
}

/** Acuerdo juez-humano (ADR-040). `target` de un desacuerdo es `run:<datasetRunId>:<itemIndex>`. */
export interface JudgeHumanMetricDto {
  name: string;
  dataType: "numeric" | "boolean" | "categorical";
  status: "ok" | "incomparable" | "mixed_judges";
  reason?: string;
  /** Identidad del juez; `null` si no se registró o si hay varias (`status: "mixed_judges"`). */
  judge: { model: string | null; promptHash: string | null } | null;
  judges: Array<{ model: string | null; promptHash: string | null }>;
  n: number;
  excluded: { ties: number; noHuman: number; noJudge: number; invalid: number };
  percentAgreement: number | null;
  kappa: number | null;
  kappaReason?: "no_variance";
  binary?: { tp: number; fp: number; fn: number; tn: number };
  confusion?: { labels: string[]; matrix: number[][] };
  mae?: number | null;
  pearson?: number | null;
  spearman?: number | null;
  withinOne?: number | null;
  lowSample: boolean;
  disagreements: Array<{ target: string; judge: string; human: string }>;
}

export interface JudgeHumanAgreementResponse {
  scope: {
    type: "run" | "queue";
    id: string;
    traceTargets: number;
    /** Solo en colas: cómo se eligieron los items de run de la cola (ADR-040), para juzgar cuán representativa es la muestra. */
    population?: { manual: number; filter: number; randomSample: number };
  };
  metrics: JudgeHumanMetricDto[];
  unmatched: { judgeOnly: string[]; humanOnly: string[] };
}

export interface InterAnnotatorMetricDto {
  name: string;
  dataType: "numeric" | "boolean" | "categorical";
  annotators: number;
  n: number;
  pairs: number;
  meanPairwiseKappa?: number | null;
  meanPairwiseSpearman?: number | null;
  lowSample: boolean;
}

export interface InterAnnotatorAgreementResponse {
  scope: { type: "queue"; id: string };
  metrics: InterAnnotatorMetricDto[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
}

// ── Registro de asistentes (ADR-053) ───────────────────────────────────────────────────────────────────────────

export type HealthStatusDto = "up" | "degraded" | "down" | "unknown";
export type AuthMethodDto = "none" | "api_key" | "oauth2" | "mtls" | "other";
export type ConnectionKindDto = "mcp_server" | "tool" | "agent";
export type ConnectionStatusDto = "pending" | "approved" | "blocked";
export type GrantSubjectTypeDto = "user" | "group" | "everyone";

export interface EnvironmentDto {
  id: string;
  key: string;
  label: string;
  position: number;
  isProduction: boolean;
  healthIntervalSeconds: number;
}

export interface DeploymentDto {
  id: string;
  experimentId: string;
  environmentId: string;
  apiUrl: string;
  /** null = `apiUrl` + `/health` */
  healthUrl: string | null;
  version: string | null;
  /** rama o tag que se despliega en este entorno (ADR-064) */
  deployRef: string | null;
  authMethod: AuthMethodDto;
  authProvider: string | null;
  authAudience: string | null;
  healthCheckEnabled: boolean;
  healthIntervalSeconds: number | null;
  healthStatus: HealthStatusDto;
  healthCheckedAt: string | null;
  healthStatusSince: string | null;
  healthLatencyMs: number | null;
  healthConsecutiveFailures: number;
}

export interface DeploymentSummaryDto extends DeploymentDto {
  environment: EnvironmentDto;
  access: { everyone: boolean; groups: number; users: number };
  /** últimas 24 h en 36 tramos, el más antiguo primero; `null` = sin sondeos en el tramo */
  recent: { buckets: Array<HealthStatusDto | null>; uptimePercent: number | null };
}

export interface AssistantMemberDto {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
}

/** Cómo se habla con el agente (ADR-055): el path es el mismo en todos los entornos; el host sale de cada despliegue. */
export interface ChatConfigDto {
  path: string;
  requestField: string;
  responseField: string;
  sessionField: string | null;
  /** clave de la respuesta con el id de la traza; null = el agente no la devuelve y el panel no ofrece 👍/👎 (ADR-062) */
  traceIdField: string | null;
}

/** Dónde vive el código del agente (ADR-064). */
export interface RepoConfigDto {
  url: string;
  provider: "github" | "gitlab" | "bitbucket";
  deployWorkflow: string | null;
}

export interface ChatResponseDto {
  reply: string;
  sessionId: string | null;
  /** traza de esta respuesta, si el agente la devuelve en `traceIdField` */
  traceId: string | null;
  latencyMs: number;
}

export interface AssistantCardDto {
  experimentId: string;
  name: string;
  serviceName: string;
  description: string;
  owner: { id: string; name: string | null; email: string; image: string | null } | null;
  lifecycle: "active" | "retired";
  /** null = el agente no declara endpoint de chat */
  chat: ChatConfigDto | null;
  /** null = el agente no declara repositorio */
  repo: RepoConfigDto | null;
  createdAt: string;
  updatedAt: string;
  deployments: DeploymentSummaryDto[];
  connectionCounts: { mcpServers: number; tools: number; agents: number; toReview: number };
  mcpServerNames: string[];
  /** quién participa en el experimento (técnicos y de negocio), con su foto si el proveedor de identidad la da */
  members: { total: number; preview: AssistantMemberDto[] };
  /** el peor estado de sus despliegues; null si no tiene ninguno */
  status: HealthStatusDto | null;
}

/** Respuesta del gate de despliegue (ADR-064): si un commit puede desplegarse y por qué. */
export interface DeployGateDto {
  allowed: boolean;
  verdict: "allowed" | "rollback" | "no_evaluation" | "evaluation_running" | "only_dirty_runs" | "failed" | "insufficient_runs";
  sha: string;
  requiredRuns: number;
  reason: string;
  /** runs completos y limpios del commit que se miraron, el más reciente primero */
  runs: Array<{ runId: string; name: string; passed: boolean; failures: Array<{ evaluator: string; passRate: number | null; target: number; incomplete?: { scored: number; items: number } }> }>;
}

/** Un despliegue lanzado desde MemTrace (ADR-064). */
export interface DeployRunDto {
  id: string;
  deploymentId: string;
  commitSha: string;
  ref: string;
  requestedBy: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  gateVerdict: string;
  gateBypassed: boolean;
  bypassReason: string | null;
  providerRunUrl: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DeployRunsResponse {
  items: DeployRunDto[];
}

/** Qué se desplegaría ahora en un entorno y si el gate lo permite. */
export interface DeployPreviewDto {
  ref: string;
  sha: string;
  environment: string;
  gate: DeployGateDto;
}

export interface AssistantCatalogResponse {
  items: AssistantCardDto[];
}

export interface EnvironmentsResponse {
  items: EnvironmentDto[];
}

export interface HealthCheckDto {
  checkedAt: string;
  status: HealthStatusDto;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
}

export interface HealthHistoryResponse {
  items: HealthCheckDto[];
}

export interface ConnectionDto {
  id: string;
  kind: ConnectionKindDto;
  name: string;
  via: string | null;
  peerExperimentId: string | null;
  declared: boolean;
  status: ConnectionStatusDto;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  /** últimos 7 días; en un servidor MCP, la suma de sus tools; null donde todavía no se mide (agentes) */
  usage: { calls: number; errors: number } | null;
}

export interface ConnectionsResponse {
  items: ConnectionDto[];
}

export interface AssistantPersonDto {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface PeopleResponse {
  items: AssistantPersonDto[];
}

export interface AccessGrantDto {
  id: string;
  deploymentId: string;
  subjectType: GrantSubjectTypeDto;
  userId: string | null;
  user: AssistantPersonDto | null;
  externalGroup: string | null;
  memberCount: number | null;
  source: "manual" | "oidc" | "scim";
  syncedAt: string | null;
}

export interface AccessGrantsResponse {
  items: AccessGrantDto[];
}

// ---- Registro de prompts (ADR-067) ----

export interface PromptDto {
  id: string;
  organizationId: string;
  /** `fragment`: texto compartido que otros prompts incluyen con `{{> nombre@tag}}` (ADR-073) */
  kind: "prompt" | "fragment";
  name: string;
  description: string;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** agentes (experimentos) a los que pertenece; puede ser más de uno */
  experimentIds: string[];
}

export interface PromptSummaryDto extends PromptDto {
  latestVersion: number;
  /** tag -> número de versión al que apunta ahora */
  tags: Record<string, number>;
}

/** De dónde sale un borrador: el fallo que se quería arreglar (ADR-072). */
export interface VersionOriginDto {
  kind: "fix";
  traceIds: string[];
  cause: string | null;
  rationale: string;
}

/** Una inclusión de un fragmento, fijada a la versión exacta con la que se resolvió al guardar (ADR-073). */
export interface IncludeDto {
  name: string;
  ref: string;
  version: number;
}

export interface IncludeStatusDto {
  name: string;
  ref: string;
  pinned: number;
  /** versión a la que resuelve la referencia hoy; null si el fragmento o el tag ya no existen */
  current: number | null;
  outdated: boolean;
}

export interface UsedByDto {
  promptId: string;
  name: string;
  version: number;
  outdated: boolean;
}

/** Mapa de dependencias de un prompt (ADR-074). */
export interface PromptMapDto {
  agents: Array<{
    experimentId: string;
    name: string;
    serving: Array<{ environment: string; tag: string; version: number; lastSeenAt: string }>;
  }>;
  dataset: { id: string; name: string; experimentId: string; requiredRuns: number } | null;
  includes: IncludeStatusDto[];
  usedBy: UsedByDto[];
  /** qué cambia si el tag pasa a la versión preguntada; null si no se preguntó */
  impact: {
    tag: string;
    toVersion: number;
    agents: Array<{ experimentId: string; name: string; environment: string; from: number; to: number; changes: boolean }>;
    pinned: number;
    willBeBehind: Array<{ promptId: string; name: string }>;
  } | null;
}

export interface PromptVersionDto {
  version: number;
  /** lo que escribió quien la editó, con `{{> nombre@tag}}` sin resolver; null si no incluye nada. `content` es el texto ya resuelto */
  source: string | null;
  includes: IncludeDto[];
  /** `draft`: propuesta pendiente de revisión; se puede probar y evaluar, pero no recibe tags hasta publicarse */
  status: "draft" | "published";
  origin: VersionOriginDto | null;
  publishedAt: string | null;
  content: string;
  /** variables {{nombre}} detectadas al guardar */
  variables: string[];
  contentHash: string;
  parentVersion: number | null;
  message: string;
  createdBy: string | null;
  createdAt: string;
}

export interface PromptTagDto {
  tag: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PromptTagEventDto {
  id: string;
  tag: string;
  fromVersion: number | null;
  /** null = el tag se quitó */
  toVersion: number | null;
  changedBy: string | null;
  reason: string;
  createdAt: string;
  /** lo que dijo el gate de promoción (ADR-070); null en los movimientos anteriores al gate */
  gateVerdict: string | null;
  /** alguien se saltó el gate; `bypassReason` lo justifica */
  gateBypassed: boolean;
  bypassReason: string | null;
}

/** Política de promoción de un prompt (ADR-070). */
export interface PromptPolicyDto {
  /** null: el dataset se borró y la política bloquea hasta elegir otro */
  datasetId: string | null;
  requiredRuns: number;
  updatedBy: string | null;
  updatedAt: string;
}

/** Si una versión puede promoverse a un entorno protegido y por qué (ADR-070). */
export interface PromptGateDto {
  allowed: boolean;
  verdict: "not_gated" | "no_policy" | "rollback" | "policy_incomplete" | "no_evaluation" | "evaluation_running" | "failed" | "insufficient_runs" | "allowed";
  tag: string;
  version: number;
  requiredRuns: number;
  reason: string;
  /** runs completos de esa versión que se miraron, el más reciente primero */
  runs: Array<{ runId: string; name: string; passed: boolean; failures: Array<{ evaluator: string; passRate: number | null; target: number; incomplete?: { scored: number; items: number } }> }>;
}

/** Una versión que un agente informa estar usando (ADR-068). */
export interface PromptUsageDto {
  experimentId: string;
  /** vacío = el agente no declara entorno */
  environment: string;
  /** tag que sigue el agente; vacío = pidió una versión fija */
  tag: string;
  version: number;
  lastSeenAt: string;
  /** informado hace poco: la versión que corre ahora, no un resto del pasado */
  active: boolean;
}

/** Lo que recibe el SDK de un agente al pedir un prompt (ADR-068). */
export interface PromptResolveDto {
  name: string;
  version: number;
  /** tag por el que se pidió; null si se pidió una versión fija */
  tag: string | null;
  content: string;
  variables: string[];
  contentHash: string;
  archived: boolean;
  /** true: es un override del playground para una sola petición, no la versión de un tag (ADR-071) */
  playground: boolean;
  /** true: es un borrador pedido por número (para evaluarlo antes de publicarlo, ADR-072) */
  draft: boolean;
}

/** Resultado de probar una versión de un prompt en el asistente real (ADR-071). */
export interface PromptPlaygroundResponse {
  reply: string;
  sessionId: string | null;
  traceId: string | null;
  latencyMs: number;
  version: number;
  /** false: el agente respondió sin aplicar el override; la respuesta no es de esa versión */
  applied: boolean;
}

export interface PromptDetailDto {
  prompt: PromptDto;
  /** más recientes primero */
  versions: PromptVersionDto[];
  tags: PromptTagDto[];
  events: PromptTagEventDto[];
  /** versiones que los agentes informan estar usando, la más reciente primero */
  usage: PromptUsageDto[];
  /** claves de entorno de la organización: mover esos tags exige `prompt:promote` */
  environmentKeys: string[];
  /** entornos que exigen pasar la política para mover su tag: todos menos el primero (ADR-070) */
  gatedEnvironments: string[];
  /** null = sin política: cualquier versión puede promoverse */
  policy: PromptPolicyDto | null;
  /** los fragmentos que incluye la última versión publicada y si han cambiado desde que se fijaron (ADR-073) */
  includes: IncludeStatusDto[];
  /** si es un fragmento: los prompts que lo incluyen */
  usedBy: UsedByDto[];
  /** nombre (o email) de quien creó versiones y movió tags, por id de usuario */
  people: Record<string, string>;
}

/** Evidencia de una versión de un prompt (ADR-069): lo que pasó en las trazas que la usaron. */
export interface VersionEvidenceDto {
  version: number;
  traces: number;
  conversations: number;
  errorTraces: number;
  /** 0-1 */
  errorRate: number;
  latencyMs: { p50: number; p95: number };
  inputTokens: number;
  outputTokens: number;
  /** null si ningún modelo usado tiene precio conocido */
  costUsd: number | null;
  costPerTraceUsd: number | null;
  /** false: algún modelo usado no tiene precio, así que el coste es un mínimo */
  costComplete: boolean;
  feedback: { up: number; down: number; ratedTraces: number; satisfaction: number | null };
  evaluators: { name: string; dataType: string; items: number; value: number | null }[];
  /** causas de error de negocio (ADR-066), las más graves primero */
  errorCauses: { id: string; title: string; severity: "high" | "medium" | "low"; traces: number }[];
  firstSeen: string;
  lastSeen: string;
}

export interface PromptEvidenceResponse {
  range: { from: string; to: string };
  /** más reciente primero; solo las versiones con tráfico en el rango */
  versions: VersionEvidenceDto[];
}

export interface PromptListResponse {
  items: PromptSummaryDto[];
}
