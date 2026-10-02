import type {
  ApiKey,
  CustomMetric,
  Dataset,
  DatasetItem,
  DatasetRun,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  ExperimentSummary,
  Member,
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

  /** Datasets de evaluación offline del experimento (ADR-028), más recientes primero. */
  listDatasets(experimentId: string): Promise<Dataset[]>;
  createDataset(experimentId: string, createdByUserId: string, name: string): Promise<Dataset>;
  getDataset(datasetId: string): Promise<Dataset | null>;
  addDatasetItems(datasetId: string, items: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>): Promise<DatasetItem[]>;
  listDatasetItems(datasetId: string): Promise<DatasetItem[]>;

  /** Metadatos de una ejecución (los scores viven en ClickHouse, ver `ScoreRepository`). `id` lo
   * genera el caller (`EvaluationService`) para poder escribir en ClickHouse con el mismo id antes
   * de crear este registro, y así no dejar un `dataset_run` huérfano si ClickHouse falla. */
  createDatasetRun(id: string, datasetId: string, name: string, itemCount: number): Promise<DatasetRun>;
  listDatasetRuns(datasetId: string): Promise<DatasetRun[]>;
  getDatasetRun(runId: string): Promise<DatasetRun | null>;
}
