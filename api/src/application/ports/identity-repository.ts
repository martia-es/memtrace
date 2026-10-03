import type {
  ApiKey,
  CustomMetric,
  Dataset,
  DatasetItem,
  DatasetRun,
  DatasetRunStatus,
  DatasetRunWithDataset,
  DatasetVersion,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  ExperimentSummary,
  Member,
  MetricReport,
  MetricReportChartLayout,
  MetricReportWithCharts,
  Organization,
  OrganizationSummary,
  OrganizationTheme,
  PendingInvitation,
  PendingInvitationTarget,
  User,
} from "@/domain/identity";

/** Puerto hacia el almacén de identidad (PostgreSQL, ver ADR-013). Auth.js gestiona users/accounts/sessions aparte. */
export interface IdentityRepository {
  getUserByEmail(email: string): Promise<User | null>;
  /** Usuarios por id en una sola consulta (nombres de anotadores, ADR-037). Los ids desconocidos simplemente no aparecen. */
  getUsersByIds(userIds: string[]): Promise<User[]>;

  createOrganization(name: string, ownerUserId: string): Promise<Organization>;
  getOrganization(organizationId: string): Promise<Organization | null>;
  /** Todas las organizaciones visibles (org_admin, o con al menos un experimento con membership directa). */
  listOrganizationsForUser(userId: string): Promise<OrganizationSummary[]>;
  isOrgAdmin(userId: string, organizationId: string): Promise<boolean>;
  addOrgAdmin(organizationId: string, userId: string): Promise<void>;
  listOrgMembers(organizationId: string): Promise<Member[]>;
  /** Reemplaza el tema visual de la organización (ADR-019). Requiere ser org_admin (comprobado por el caller). */
  updateOrganizationTheme(organizationId: string, theme: OrganizationTheme): Promise<Organization>;

  createExperiment(organizationId: string, name: string, serviceName: string): Promise<Experiment>;
  getExperiment(experimentId: string): Promise<Experiment | null>;
  listExperimentsForUser(userId: string): Promise<ExperimentSummary[]>;

  addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void>;
  listExperimentMembers(experimentId: string): Promise<Member[]>;

  /** Guarda una invitación para alguien que todavía no tiene cuenta en MemTrace. */
  createPendingInvitation(email: string, target: PendingInvitationTarget, invitedByUserId: string): Promise<void>;
  /** Aplica (y borra) las invitaciones pendientes de este email al crear la cuenta (events.createUser en auth.ts). */
  applyPendingInvitations(userId: string, email: string): Promise<void>;
  /** Invitaciones sin aceptar todavía de una organización o experimento concreto, más recientes primero. */
  listPendingInvitations(target: { organizationId: string } | { experimentId: string }): Promise<PendingInvitation[]>;

  /** org_admin de la organización dueña del experimento, o membership directa. `null` si no hay acceso. */
  resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess>;

  /** Devuelve la key en claro (única vez) además de sus metadatos. */
  createApiKey(experimentId: string, createdByUserId: string): Promise<{ apiKey: ApiKey; plaintext: string }>;
  listApiKeys(experimentId: string): Promise<ApiKey[]>;
  revokeApiKey(experimentId: string, keyId: string): Promise<void>;
  /** Para el gateway de ingesta (piece 9) y `requireExperimentAccess` (ADR-028): experimentId de
   * una key en claro válida y no revocada, o `null`. `createdByUserId` es quien creó la key, usado
   * como autor de lo que el agente crea vía API (datasets) al no tener usuario propio. */
  resolveApiKey(plaintext: string): Promise<{ experimentId: string; serviceName: string; createdByUserId: string } | null>;

  /** Gráficos custom guardados del experimento (ADR-027), más recientes primero. */
  listCustomMetrics(experimentId: string): Promise<CustomMetric[]>;
  createCustomMetric(experimentId: string, createdByUserId: string, name: string, definition: Record<string, unknown>): Promise<CustomMetric>;
  deleteCustomMetric(experimentId: string, metricId: string): Promise<void>;

  /** Informes guardados del experimento (ADR-033): agrupan varias custom_metrics con layout de grid. */
  listMetricReports(experimentId: string): Promise<MetricReport[]>;
  createMetricReport(experimentId: string, createdByUserId: string, name: string): Promise<MetricReport>;
  /** `null` si no existe o no pertenece a ese experimento. */
  getMetricReport(experimentId: string, reportId: string): Promise<MetricReportWithCharts | null>;
  renameMetricReport(experimentId: string, reportId: string, name: string): Promise<void>;
  deleteMetricReport(experimentId: string, reportId: string): Promise<void>;
  /** Reemplaza por completo el layout: el editor de grid siempre envía el conjunto entero al guardar. */
  setMetricReportCharts(experimentId: string, reportId: string, charts: MetricReportChartLayout[]): Promise<void>;

/** Datasets de evaluación offline del experimento (ADR-028), más recientes primero. Crear un
   * dataset crea también su versión 1.0 (vacía) en la misma transacción (ADR-031). */
  listDatasets(experimentId: string): Promise<Dataset[]>;
  createDataset(experimentId: string, createdByUserId: string, name: string): Promise<Dataset>;
  getDataset(datasetId: string): Promise<Dataset | null>;
  deleteDataset(datasetId: string): Promise<void>;

  /** Historial de versiones de un dataset (ADR-032), más recientes primero. Puramente informativo:
   * nunca se crean a mano, son el resultado de `addDatasetItems`/`updateDatasetItem`/`deleteDatasetItem`. */
  listDatasetVersions(datasetId: string): Promise<DatasetVersion[]>;
  getLatestDatasetVersion(datasetId: string): Promise<DatasetVersion | null>;

  /** Items activos (no borrados) de una versión de un dataset (lo único que expone el dashboard
   * de gestión como "items actuales"). */
  listDatasetItems(datasetVersionId: string): Promise<DatasetItem[]>;
  /** Todos los items de una versión concreta, incluidos los tombstones de items borrados ahí
   * (ADR-032 follow-up) — para inspeccionar el historial, nunca para editar. */
  listDatasetVersionItemsWithDeleted(datasetVersionId: string): Promise<DatasetItem[]>;
  /** Igual que el anterior pero para todas las versiones del dataset a la vez (ADR-033). */
  listAllDatasetItemsWithDeleted(datasetId: string): Promise<DatasetItem[]>;

  /** Añade items a un dataset: clona los items activos de la última versión y crea una nueva con
   * bump MAJOR (cambio estructural), atribuyendo los items nuevos a `createdByUserId` (ADR-032). */
  addDatasetItems(datasetId: string, createdByUserId: string, items: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>): Promise<DatasetItem[]>;
  /** Edita un item de la última versión: clona el resto de items tal cual (preservando su autoría
   * original) y crea una nueva versión con bump MINOR, marcando `updatedBy`/`updatedAt` en el item editado. */
  updateDatasetItem(datasetId: string, itemId: string, updatedByUserId: string, patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }): Promise<DatasetItem | null>;
  /** Borra un item de la última versión: crea una nueva versión con bump MAJOR en la que el item
   * borrado sigue existiendo como tombstone (`deletedBy`/`deletedAt` marcados, contenido y autoría
   * original preservados) — nunca desaparece sin dejar rastro de quién lo borró y cuándo. */
  deleteDatasetItem(datasetId: string, itemId: string, deletedByUserId: string): Promise<void>;

  /** Aplica altas, ediciones y bajas como UNA sola versión nueva (ADR-041): MAJOR si hay altas o bajas, MINOR si solo ediciones;
   * la nota se genera sola. `update[].id`/`remove[]` son ids de fila de la última versión; si alguno ya no existe lanza `ValidationError` y no se escribe nada. */
  commitDatasetChanges(
    datasetId: string,
    userId: string,
    changes: {
      add: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>;
      update: Array<{ id: string; patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null } }>;
      remove: string[];
    },
  ): Promise<DatasetVersion>;

  /** Metadatos de una ejecución (los scores viven en ClickHouse, ver `ScoreRepository`). `id` lo
   * genera el caller (`EvaluationService`) para poder escribir en ClickHouse con el mismo id antes
   * de crear este registro, y así no dejar un `dataset_run` huérfano si ClickHouse falla.
   * `datasetVersionId` es la versión de la que salieron los items, que declara siempre el SDK (ADR-034). */
  createDatasetRun(id: string, datasetId: string, datasetVersionId: string, name: string, itemCount: number, status: DatasetRunStatus): Promise<DatasetRun>;
  /** Sube `itemCount` al tamaño total conocido del run (nunca lo reduce: un lote reenviado es idempotente)
   * y, si `completed`, lo marca como completado. Devuelve null si el run no existe. */
  updateDatasetRunProgress(runId: string, itemCount: number, completed: boolean): Promise<DatasetRun | null>;
  listDatasetRuns(datasetId: string): Promise<DatasetRun[]>;
  getDatasetRun(runId: string): Promise<DatasetRun | null>;
  /** Todos los runs del experimento, de cualquier dataset, para la vista global "Runs" del dashboard. */
  listRunsForExperiment(experimentId: string): Promise<DatasetRunWithDataset[]>;
}
