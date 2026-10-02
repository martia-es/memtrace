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

export interface TraceSummaryDto {
  traceId: string;
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
  /** conversación a la que pertenece el turno (ADR-012) */
  conversationId: string | null;
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
  framework: string | null;
  roots: SpanNodeDto[];
}

/** Conversación = trazas (turnos) con el mismo `gen_ai.conversation.id` (ADR-012). */
export interface ConversationSummaryDto {
  conversationId: string;
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
  byTool: { tool: string; calls: number; errors: number; p95Ms: number }[];
  /** vacío si el worker de temáticas (ADR-022) aún no ha corrido sobre este rango */
  byTopic: { topic: string; responses: number; avgConfidence: number }[];
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

export interface ScoreAggregateDto {
  name: string;
  dataType: ScoreDataTypeDto;
  /** solo si `dataType === "boolean"`: fracción (0-1) de scores con valor `"true"` */
  passRate: number | null;
  /** solo si `dataType === "numeric"`: media del valor */
  average: number | null;
  count: number;
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

export interface DatasetItemsListResponse {
  items: DatasetItemDto[];
}

export interface UpdateDatasetItemBody {
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown> | null;
}

export type ScoreDataTypeDto = "numeric" | "boolean" | "categorical";
export type ScoreSourceDto = "human" | "code" | "llm_judge";

export interface ScoreDto {
  name: string;
  value: string;
  dataType: ScoreDataTypeDto;
  source: ScoreSourceDto;
  comment: string | null;
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
  createdAt: string;
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

export interface DatasetRunItemResultDto extends DatasetRunItemSubmissionDto {
  itemIndex: number;
}

export interface DatasetRunDetailResponse {
  dataset: { id: string; name: string };
  run: DatasetRunSummaryDto;
  items: DatasetRunItemResultDto[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
}
