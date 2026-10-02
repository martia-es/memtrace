import type {
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  CustomMetricResultResponse,
  DatasetDto,
  DatasetItemDto,
  DatasetItemsListResponse,
  DatasetRunDetailResponse,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDto,
  DatasetVersionsListResponse,
  ExperimentUsageResponse,
  ModelPricingResponse,
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
  conversationId?: string;
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
  limit?: number;
  cursor?: string;
}

/** Puerto de salida: lo que el dashboard necesita del backend. Es el único acceso a datos (roadmap, pieza 5). */
export interface TraceApi {
  listTraces(params: ListTracesParams, signal?: AbortSignal): Promise<TraceListResponse>;
  /** spans sueltos (más recientes primero) con una vista previa de su entrada y salida */
  listSpans(params: ListSpansParams, signal?: AbortSignal): Promise<SpanListResponse>;
  getTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetailResponse>;
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

  /** items de la última versión del dataset. Cada mutación crea su propia versión sola (ADR-032):
   * añadir/borrar sube major, editar sube minor — nunca hay un paso "new version" aparte. */
  listDatasetItems(datasetId: string, signal?: AbortSignal): Promise<DatasetItemsListResponse>;
  createDatasetItem(datasetId: string, item: { input: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal): Promise<DatasetItemDto>;
  updateDatasetItem(datasetId: string, itemId: string, patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal): Promise<DatasetItemDto>;
  deleteDatasetItem(datasetId: string, itemId: string, signal?: AbortSignal): Promise<void>;

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
