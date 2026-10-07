import type {
  AddQueueItemsResponse,
  InterAnnotatorAgreementResponse,
  JudgeHumanAgreementResponse,
  AnnotationQueueDetailResponse,
  AnnotationQueueDto,
  AnnotationQueuesListResponse,
  ReviewerCandidatesResponse,
  NextQueueItemResponse,
  QueueItemDto,
  QueueItemsResponse,
  QueueResolutionDto,
  QueueResultsResponse,
  TraceQueuesResponse,
  ResolveQueueItemBody,
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  LowRatedResponse,
  AnnotationRatingsResponse,
  FeedbackOverviewResponse,
  FeedbackRatingsResponse,
  TraceFeedbackResponse,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  CustomMetricResultResponse,
  DatasetDto,
  CommitDatasetChangesBody,
  PromoteTracesBody,
  PromoteTracesResponse,
  DatasetItemDto,
  DatasetItemsListResponse,
  DatasetRunDetailResponse,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDiffResponse,
  DatasetVersionDto,
  DatasetVersionsListResponse,
  ExperimentUsageResponse,
  ModelPricingResponse,
  TraceAnnotationsResponse,
  OverviewResponse,
  RunsListResponse,
  ServicesResponse,
  SpanListResponse,
  StepKindsResponse,
  TraceDetailResponse,
  TraceListResponse,
  TranscriptResponse,
} from "@contract";

export interface RangeParams {
  from: string;
  to: string;
}

export interface ListTracesParams extends RangeParams {
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  /** texto contenido en la entrada o salida capturadas */
  text?: string;
  conversationId?: string;
  /** solo las trazas generadas por este commit (completo o prefijo, ADR-065) */
  revision?: string;
  limit?: number;
  cursor?: string;
}

export interface ListSpansParams extends RangeParams {
  service?: string;
  kind?: string;
  model?: string;
  status?: "ok" | "error";
  /** texto contenido en la entrada o la salida capturadas */
  text?: string;
  conversationId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListConversationsParams extends RangeParams {
  service?: string;
  hasErrors?: boolean;
  /** texto contenido en la entrada o salida capturadas */
  text?: string;
  /** solo lo generado por este commit (completo o prefijo, ADR-065) */
  revision?: string;
  limit?: number;
  cursor?: string;
}

export interface SaveAnnotationBody {
  configId: string;
  value: string | number | boolean;
  comment?: string | null;
  spanId?: string | null;
}

/** Muestra aleatoria al poblar una cola (ADR-040). Sin `seed`, el servidor la genera y la devuelve. */
export interface QueueSampleBody {
  size: number;
  seed?: string;
}

/** Qué añadir a una cola (ADR-039): exactamente una de las cuatro formas. En un filtro, `limit` y `sample` son excluyentes. */
export type AddQueueItemsBody =
  | { traceIds: string[] }
  | { fromFilter: { from?: string; to?: string; status?: "ok" | "error"; hasErrors?: boolean; minDurationMs?: number } & ({ limit: number; sample?: undefined } | { sample: QueueSampleBody; limit?: undefined }) }
  | { fromRun: { datasetRunId: string; sample?: QueueSampleBody } }
  | { runItems: Array<{ datasetRunId: string; itemIndex: number }> };

export interface NewAnnotationQueueBody {
  name: string;
  instructions?: string | null;
  requiredAnnotations: number;
  reviewerIds: string[];
  rubric: Array<{ configId: string; required: boolean }>;
}

export interface AnnotationQueuePatchBody {
  name?: string;
  instructions?: string | null;
  requiredAnnotations?: number;
  reviewerIds?: string[];
  rubric?: Array<{ configId: string; required: boolean }>;
  archived?: boolean;
}

/** Alcance del acuerdo juez-humano: un run o una cola, nunca el experimento entero. */
export type AgreementScope = { datasetRunId: string } | { queueId: string };

export interface QueueResultsParams {
  status?: QueueItemDto["status"];
  onlyDisagreements?: boolean;
  limit?: number;
  offset?: number;
}

export interface QueueLabelBody {
  configId: string;
  value: string | number | boolean;
  comment?: string | null;
}

/** Puerto de salida: lo que el dashboard necesita del backend. Es el único acceso a datos (roadmap, pieza 5). */
export interface TraceApi {
  listTraces(params: ListTracesParams, signal?: AbortSignal): Promise<TraceListResponse>;
  /** spans sueltos (más recientes primero) con una vista previa de su entrada y salida */
  listSpans(params: ListSpansParams, signal?: AbortSignal): Promise<SpanListResponse>;
  getTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetailResponse>;
  /** Anotaciones humanas de la traza (de todos los anotadores) + sus scores automáticos (ADR-037). */
  listTraceAnnotations(traceId: string, signal?: AbortSignal): Promise<TraceAnnotationsResponse>;
  /** Crea o edita MI anotación para (traza, span, config); devuelve la vista completa ya actualizada. */
  saveTraceAnnotation(traceId: string, body: SaveAnnotationBody, signal?: AbortSignal): Promise<TraceAnnotationsResponse>;
  /** Retira mi anotación (o, siendo admin, la de `annotatorId`). Idempotente. */
  retractTraceAnnotation(traceId: string, configId: string, options?: { spanId?: string | null; annotatorId?: string }, signal?: AbortSignal): Promise<void>;
  /** Colas de anotación del experimento con su progreso (ADR-039). */
  listAnnotationQueues(includeArchived?: boolean, signal?: AbortSignal): Promise<AnnotationQueuesListResponse>;
  /** trazas con alguna valoración humana baja en el rango, para "Needs attention" (ADR-049) */
  getLowRated(params: RangeParams, signal?: AbortSignal): Promise<LowRatedResponse>;
  /** Votos 👍/👎 de usuario final de la traza y si coinciden con la revisión humana (ADR-062). */
  getTraceFeedback(traceId: string, signal?: AbortSignal): Promise<TraceFeedbackResponse>;
  /** Votos de usuario final de las trazas o conversaciones de una página de lista. */
  getFeedbackRatings(target: { traceIds: string[] } | { conversationIds: string[] }, signal?: AbortSignal): Promise<FeedbackRatingsResponse>;
  /** Satisfacción, serie diaria, alineación y últimas trazas con 👎 del rango. */
  getFeedbackOverview(params: RangeParams, signal?: AbortSignal): Promise<FeedbackOverviewResponse>;
  /** etiquetas humanas (y si alguna es baja) de las trazas o conversaciones de una página de lista; solo vuelven las que tienen alguna */
  getAnnotationRatings(target: { traceIds: string[] } | { conversationIds: string[] }, signal?: AbortSignal): Promise<AnnotationRatingsResponse>;
  createAnnotationQueue(body: NewAnnotationQueueBody, signal?: AbortSignal): Promise<AnnotationQueueDto>;
  getAnnotationQueue(queueId: string, signal?: AbortSignal): Promise<AnnotationQueueDetailResponse>;
  /** Quién se puede asignar como revisor: miembros del experimento y org_admin (solo admin). */
  listReviewerCandidates(signal?: AbortSignal): Promise<ReviewerCandidatesResponse>;
  updateAnnotationQueue(queueId: string, patch: AnnotationQueuePatchBody, signal?: AbortSignal): Promise<AnnotationQueueDetailResponse>;
  listAnnotationQueueItems(queueId: string, status?: QueueItemDto["status"], signal?: AbortSignal): Promise<QueueItemsResponse>;
  addAnnotationQueueItems(queueId: string, body: AddQueueItemsBody, signal?: AbortSignal): Promise<AddQueueItemsResponse>;
  /** Reclama el siguiente item para mí (o el que ya tenía abierto); `item: null` si no queda ninguno. */
  nextAnnotationQueueItem(queueId: string, signal?: AbortSignal): Promise<NextQueueItemResponse>;
  completeAnnotationQueueItem(queueId: string, itemId: string, labels: QueueLabelBody[], signal?: AbortSignal): Promise<QueueItemDto>;
  skipAnnotationQueueItem(queueId: string, itemId: string, signal?: AbortSignal): Promise<QueueItemDto>;
  /** Solo admin: el item deja de repartirse. */
  markAnnotationQueueItemUnreviewable(queueId: string, itemId: string, signal?: AbortSignal): Promise<QueueItemDto>;
  /** Colas de revisión que contienen la traza y el estado de su item (ADR-050). */
  listTraceQueues(traceId: string, signal?: AbortSignal): Promise<TraceQueuesResponse>;
  /** Solo admin (ADR-050): qué respondió cada revisor por item y criterio, con desacuerdos y resoluciones. */
  getQueueResults(queueId: string, params?: QueueResultsParams, signal?: AbortSignal): Promise<QueueResultsResponse>;
  /** Solo admin: el técnico fija el valor final de un criterio (y, opcional, la respuesta correcta). No toca las etiquetas. */
  resolveQueueItem(queueId: string, itemId: string, configId: string, body: ResolveQueueItemBody, signal?: AbortSignal): Promise<QueueResolutionDto>;
  clearQueueResolution(queueId: string, itemId: string, configId: string, signal?: AbortSignal): Promise<void>;
  /** Acuerdo del juez LLM con las etiquetas humanas sobre un run o una cola (ADR-040). `name` limita a un evaluador. */
  getJudgeHumanAgreement(scope: AgreementScope, name?: string, signal?: AbortSignal): Promise<JudgeHumanAgreementResponse>;
  /** Acuerdo entre quienes etiquetaron los items de una cola (ADR-040). */
  getInterAnnotatorAgreement(queueId: string, name?: string, signal?: AbortSignal): Promise<InterAnnotatorAgreementResponse>;
  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  /** igual que getOverview pero para un experimento explícito, sin depender del scoping por setExperimentId (comparativa entre agentes) */
  getOverviewForExperiment(experimentId: string, params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  listServices(params: RangeParams, signal?: AbortSignal): Promise<ServicesResponse>;
  /** tokens por experimento accesible al usuario, para la comparativa de coste entre agentes */
  getUsageByExperiment(params: RangeParams, signal?: AbortSignal): Promise<ExperimentUsageResponse>;
  listConversations(params: ListConversationsParams, signal?: AbortSignal): Promise<ConversationListResponse>;
  /** mensajes usuario/asistente por turno; `contentCaptured=false` si el agente no guardó contenido */
  getTranscript(conversationId: string, signal?: AbortSignal): Promise<TranscriptResponse>;
  /** resumen + turnos en orden cronológico */
  getConversation(conversationId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationDetailResponse>;
  /** árbol de spans de cada turno, en el mismo orden y página que getConversation (vista de árbol unificado) */
  getConversationTree(conversationId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationTreeResponse>;
  /** catálogo de precios por modelo (ADR-025), para la vista de precios */
  getModelPricing(signal?: AbortSignal): Promise<ModelPricingResponse>;

  /** `memtrace.step_type` distintos vistos en el rango, para el selector del builder de gráficos custom (ADR-027) */
  getStepKinds(params: RangeParams, signal?: AbortSignal): Promise<StepKindsResponse>;
  /** valores distintos de un atributo, acotados a los step types dados (ADR-027) */
  getAttributeValues(params: RangeParams & { stepTypes: string[]; attribute: string }, signal?: AbortSignal): Promise<AttributeValuesResponse>;
  /** claves de atributo vistas en los step types dados, para los selectores de "group by"/"filter by" (ADR-030) */
  getAttributeKeys(params: RangeParams & { stepTypes: string[] }, signal?: AbortSignal): Promise<AttributeKeysResponse>;
  /** calcula un gráfico custom sin persistirlo (ADR-027) */
  queryCustomMetric(definition: CustomMetricDefinitionDto, range: RangeParams, signal?: AbortSignal): Promise<CustomMetricResultResponse>;

  /** datasets de evaluación offline del experimento (ADR-028) */
  listDatasets(signal?: AbortSignal): Promise<DatasetsListResponse>;
  getDataset(datasetId: string, signal?: AbortSignal): Promise<DatasetDto>;
  createDataset(name: string, signal?: AbortSignal): Promise<DatasetDto>;
  deleteDataset(datasetId: string, signal?: AbortSignal): Promise<void>;

  /** historial de versiones de un dataset (ADR-032), más recientes primero. Puramente
   * informativo: no hay forma de crear una a mano, son el resultado de editar items. */
  listDatasetVersions(datasetId: string, signal?: AbortSignal): Promise<DatasetVersionsListResponse>;
  /** items de una versión concreta, incluidos los tombstones de items borrados ahí — para ver
   * quién borró qué y cuándo (ADR-032 follow-up). Solo lectura, nunca para editar. */
  listDatasetVersionItemsWithDeleted(datasetId: string, versionId: string, signal?: AbortSignal): Promise<DatasetItemsListResponse>;
  /** Diff de una versión contra `againstVersionId` (cualquiera); sin él, contra la inmediatamente anterior (ADR-033). */
  getDatasetVersionDiff(datasetId: string, versionId: string, againstVersionId?: string, signal?: AbortSignal): Promise<DatasetVersionDiffResponse>;

  /** items de la última versión del dataset. Cada mutación crea su propia versión sola (ADR-032):
   * añadir/borrar sube major, editar sube minor — nunca hay un paso "new version" aparte. */
  listDatasetItems(datasetId: string, signal?: AbortSignal): Promise<DatasetItemsListResponse>;
  createDatasetItem(datasetId: string, item: { input: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal): Promise<DatasetItemDto>;
  updateDatasetItem(datasetId: string, itemId: string, patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal): Promise<DatasetItemDto>;
  deleteDatasetItem(datasetId: string, itemId: string, signal?: AbortSignal): Promise<void>;
  /** Promueve trazas a items del dataset: UNA versión MAJOR por llamada (ADR-038). */
  promoteTracesToDataset(datasetId: string, body: PromoteTracesBody, signal?: AbortSignal): Promise<PromoteTracesResponse>;
  /** Publica una sesión de edición (altas+ediciones+bajas) como UNA sola versión (ADR-041). */
  commitDatasetChanges(datasetId: string, changes: CommitDatasetChangesBody, signal?: AbortSignal): Promise<DatasetItemsListResponse>;

  /** ejecuciones guardadas de un dataset, más recientes primero */
  listDatasetRuns(datasetId: string, signal?: AbortSignal): Promise<DatasetRunsListResponse>;
  /** todas las ejecuciones del experimento, de cualquier dataset (ADR-031) */
  listRuns(signal?: AbortSignal): Promise<RunsListResponse>;
  /** detalle de una ejecución: metadatos + items con sus scores */
  getDatasetRun(datasetId: string, runId: string, signal?: AbortSignal): Promise<DatasetRunDetailResponse>;
}

/** Error de la API (RFC 7807) o de conexión (`status === 0`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = "ApiError";
  }
}
