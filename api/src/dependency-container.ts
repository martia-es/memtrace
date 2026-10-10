/** Composition root: único sitio donde se eligen los adapters concretos y se lee el entorno. */
import { TraceQueryService } from "@/application/trace-query-service";
import { createHandlers, type Handlers } from "@/adapters/inbound/http/handlers";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseAnnotationRepository } from "@/adapters/outbound/clickhouse/clickhouse-annotation-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { configFromEnv, createReadOnlyClient, createEvaluationWriteClient } from "@/adapters/outbound/clickhouse/client";
import { AuthorizationService } from "@/application/authorization-service";
import { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { ChatClient } from "@/application/ports/chat-client";
import type { HealthProber } from "@/application/ports/health-prober";
import { HttpChatClient } from "@/adapters/outbound/http/http-chat-client";
import { HttpHealthProber } from "@/adapters/outbound/http/http-health-prober";
import { PostgresAssistantRegistryRepository } from "@/adapters/outbound/postgres/postgres-assistant-registry-repository";
import { AnnotationQueueService } from "@/application/annotation-queue-service";
import { PostgresAnnotationQueueRepository } from "@/adapters/outbound/postgres/postgres-annotation-queue-repository";
import { AgreementService } from "@/application/agreement-service";
import { AnnotationService } from "@/application/annotation-service";
import { UserFeedbackService } from "@/application/user-feedback-service";
import { ClickHouseUserFeedbackRepository } from "@/adapters/outbound/clickhouse/clickhouse-user-feedback-repository";
import { DatasetPromotionService } from "@/application/dataset-promotion-service";
import { EvaluationService } from "@/application/evaluation-service";
import { ExternalAccessService } from "@/application/external-access-service";
import type { ExternalIdentityRepository } from "@/application/ports/external-identity-repository";
import { PostgresExternalIdentityRepository } from "@/adapters/outbound/postgres/postgres-external-identity-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import { DeployGateService } from "@/application/deploy-gate-service";
import { DeployService } from "@/application/deploy-service";
import { GithubAppDispatcher, UnconfiguredDispatcher } from "@/adapters/outbound/github/github-app-dispatcher";
import { PostgresDeployRunRepository } from "@/adapters/outbound/postgres/postgres-deploy-run-repository";
import { PostgresChartCatalogRepository } from "@/adapters/outbound/postgres/postgres-chart-catalog-repository";
import { PostgresApprovalRepository } from "@/adapters/outbound/postgres/postgres-approval-repository";
import { PostgresPromptRepository } from "@/adapters/outbound/postgres/postgres-prompt-repository";
import { PromptService } from "@/application/prompt-service";
import { PromptEvidenceService } from "@/application/prompt-evidence-service";
import { PromptFailureService } from "@/application/prompt-failure-service";
import { PromptMapService } from "@/application/prompt-map-service";
import { ChartCatalogService } from "@/application/chart-catalog-service";
import { AuditService } from "@/application/audit-service";
import { RetentionService } from "@/application/retention-service";
import { ExportService } from "@/application/export-service";
import { ClickHouseDataExporter } from "@/adapters/outbound/clickhouse/clickhouse-data-exporter";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { PostgresRetentionRepository } from "@/adapters/outbound/postgres/postgres-retention-repository";
import { ApprovalRuleResolver } from "@/application/approval-rules";
import { ApprovalService } from "@/application/approval-service";
import { PromptGateService } from "@/application/prompt-gate-service";
import { PromptPlaygroundService } from "@/application/prompt-playground-service";
import { ClickHousePromptEvidenceRepository } from "@/adapters/outbound/clickhouse/clickhouse-prompt-evidence-repository";
import { PostgresScoreConfigRepository } from "@/adapters/outbound/postgres/postgres-score-config-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { configFromEnv as postgresConfigFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import type { Pool } from "pg";
import type { EmailSender } from "@/application/ports/email-sender";
import { NoopEmailSender, ResendEmailSender } from "@/adapters/outbound/email/resend-email-sender";

// En `next dev` los módulos se recargan: el contenedor se cachea en globalThis para no abrir conexiones nuevas
const globalForContainer = globalThis as unknown as {
  __memtraceHandlers?: Handlers;
  __memtraceTraceQueryService?: TraceQueryService;
  __memtraceTraceRepository?: ClickHouseTraceRepository;
  __memtraceIdentity?: { identityRepository: IdentityRepository; authorizationService: AuthorizationService; emailSender: EmailSender };
  __memtraceExternalAccess?: { externalRepository: ExternalIdentityRepository; externalAccessService: ExternalAccessService };
  __memtraceEvaluation?: EvaluationService;
  __memtraceScoreRepository?: ClickHouseScoreRepository;
  __memtracePostgresPool?: Pool;
  __memtraceAnnotation?: AnnotationService;
  __memtraceUserFeedback?: UserFeedbackService;
  __memtraceAnnotationQueue?: AnnotationQueueService;
  __memtraceAgreement?: AgreementService;
  __memtracePromotion?: DatasetPromotionService;
  __memtraceAssistantRegistry?: AssistantRegistryService;
  __memtraceDeployGate?: DeployGateService;
  __memtraceDeployRuns?: PostgresDeployRunRepository;
  __memtraceDeploy?: DeployService;
  __memtracePrompts?: PromptService;
  __memtraceChartCatalog?: ChartCatalogService;
  __memtraceAudit?: AuditService;
  __memtraceRetention?: RetentionService;
  __memtraceExport?: ExportService;
  __memtraceApprovals?: ApprovalService;
  __memtraceApprovalRepository?: PostgresApprovalRepository;
  __memtracePromptEvidence?: PromptEvidenceService;
  __memtracePromptFailures?: PromptFailureService;
  __memtracePromptGate?: PromptGateService;
  __memtracePromptMap?: PromptMapService;
  __memtracePromptPlayground?: PromptPlaygroundService;
  __memtracePromptEvidenceRepository?: ClickHousePromptEvidenceRepository;
  __memtracePromptRepository?: PostgresPromptRepository;
  __memtraceHealthProber?: HealthProber;
  __memtraceChatClient?: ChatClient;
};

/** Un único pool de Postgres compartido por identidad y score configs. */
function getPostgresPool(): Pool {
  if (!globalForContainer.__memtracePostgresPool) globalForContainer.__memtracePostgresPool = createPool(postgresConfigFromEnv());
  return globalForContainer.__memtracePostgresPool;
}

function getScoreRepository(): ClickHouseScoreRepository {
  if (!globalForContainer.__memtraceScoreRepository) {
    const config = configFromEnv();
    globalForContainer.__memtraceScoreRepository = new ClickHouseScoreRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database);
  }
  return globalForContainer.__memtraceScoreRepository;
}

function getTraceRepository(): ClickHouseTraceRepository {
  if (!globalForContainer.__memtraceTraceRepository) {
    const config = configFromEnv();
    globalForContainer.__memtraceTraceRepository = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries);
  }
  return globalForContainer.__memtraceTraceRepository;
}

/** Compartido por `getHandlers` y por los sitios que necesitan llamar al servicio directamente (p.ej. el envío por email de un informe, ADR-035). */
export function getTraceQueryService(): TraceQueryService {
  if (!globalForContainer.__memtraceTraceQueryService) {
    globalForContainer.__memtraceTraceQueryService = new TraceQueryService(getTraceRepository());
  }
  return globalForContainer.__memtraceTraceQueryService;
}

export function getHandlers(): Handlers {
  if (!globalForContainer.__memtraceHandlers) {
    globalForContainer.__memtraceHandlers = createHandlers(getTraceQueryService());
  }
  return globalForContainer.__memtraceHandlers;
}

/** Identidad externa (ADR-052, fases B y C): mapeos de grupos, conciliación de membresías y SCIM. */
export function getExternalAccess(): { externalRepository: ExternalIdentityRepository; externalAccessService: ExternalAccessService } {
  if (!globalForContainer.__memtraceExternalAccess) {
    const externalRepository = new PostgresExternalIdentityRepository(getPostgresPool());
    globalForContainer.__memtraceExternalAccess = { externalRepository, externalAccessService: new ExternalAccessService(externalRepository) };
  }
  return globalForContainer.__memtraceExternalAccess;
}

export function getIdentity(): { identityRepository: IdentityRepository; authorizationService: AuthorizationService; emailSender: EmailSender } {
  if (!globalForContainer.__memtraceIdentity) {
    const identityRepository = new PostgresIdentityRepository(getPostgresPool());
    // Solo se usa al invitar a alguien sin cuenta; no debe romper el resto de la API si no está configurado.
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailSender = resendApiKey
      ? new ResendEmailSender(resendApiKey, process.env.EMAIL_FROM ?? "MemTrace <invites@memtrace.local>")
      : new NoopEmailSender();
    globalForContainer.__memtraceIdentity = { identityRepository, authorizationService: new AuthorizationService(identityRepository), emailSender };
  }
  return globalForContainer.__memtraceIdentity;
}

export function getEvaluation(): EvaluationService {
  if (!globalForContainer.__memtraceEvaluation) {
    globalForContainer.__memtraceEvaluation = new EvaluationService(getIdentity().identityRepository, getScoreRepository());
  }
  return globalForContainer.__memtraceEvaluation;
}

/** Para leer scores directamente (detalle de una ejecución) sin pasar por `EvaluationService`, que solo expone el caso de uso de escritura. */
export function getScores(): ClickHouseScoreRepository {
  return getScoreRepository();
}

/** Anotación humana (ADR-036/037). La autorización de rol se comprueba en la ruta con `getIdentity().authorizationService`. */
export function getAnnotation(): AnnotationService {
  if (!globalForContainer.__memtraceAnnotation) {
    const config = configFromEnv();
    globalForContainer.__memtraceAnnotation = new AnnotationService(
      new PostgresScoreConfigRepository(getPostgresPool()),
      new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      getTraceRepository(),
      getScoreRepository(),
      getIdentity().identityRepository,
    );
  }
  return globalForContainer.__memtraceAnnotation;
}

/** Feedback del usuario final (ADR-062). Escribe en `user_feedback` con el mismo cliente acotado que las anotaciones. */
export function getUserFeedback(): UserFeedbackService {
  if (!globalForContainer.__memtraceUserFeedback) {
    const config = configFromEnv();
    globalForContainer.__memtraceUserFeedback = new UserFeedbackService(
      new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      new PostgresScoreConfigRepository(getPostgresPool()),
      getTraceRepository(),
    );
  }
  return globalForContainer.__memtraceUserFeedback;
}

/** Colas de anotación (ADR-039). Comparte repositorios con `getAnnotation`: las etiquetas van al mismo almacén. */
export function getAnnotationQueues(): AnnotationQueueService {
  if (!globalForContainer.__memtraceAnnotationQueue) {
    const config = configFromEnv();
    globalForContainer.__memtraceAnnotationQueue = new AnnotationQueueService(
      new PostgresAnnotationQueueRepository(getPostgresPool()),
      new PostgresScoreConfigRepository(getPostgresPool()),
      new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      getTraceRepository(),
      getIdentity().identityRepository,
    );
  }
  return globalForContainer.__memtraceAnnotationQueue;
}

/** Acuerdo juez-humano e inter-anotador (ADR-040). Solo lectura: no escribe en ninguna tabla. */
export function getAgreement(): AgreementService {
  if (!globalForContainer.__memtraceAgreement) {
    const config = configFromEnv();
    globalForContainer.__memtraceAgreement = new AgreementService(
      getIdentity().identityRepository,
      getScoreRepository(),
      new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      new PostgresAnnotationQueueRepository(getPostgresPool()),
    );
  }
  return globalForContainer.__memtraceAgreement;
}

/** Promoción de trazas a items de dataset (ADR-038). Lee trazas y anotaciones de ClickHouse y escribe solo en PostgreSQL. */
export function getDatasetPromotion(): DatasetPromotionService {
  if (!globalForContainer.__memtracePromotion) {
    const config = configFromEnv();
    globalForContainer.__memtracePromotion = new DatasetPromotionService(
      getIdentity().identityRepository,
      getTraceRepository(),
      new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
    );
  }
  return globalForContainer.__memtracePromotion;
}

/** Registro de asistentes (ADR-053). El uso de tools observado viene del servicio de consulta de trazas. */
export function getAssistantRegistry(): AssistantRegistryService {
  if (!globalForContainer.__memtraceAssistantRegistry) {
    const traces = getTraceQueryService();
    globalForContainer.__memtraceAssistantRegistry = new AssistantRegistryService(new PostgresAssistantRegistryRepository(getPostgresPool()), {
      toolUsage: async (serviceName, from, to) => (await traces.getOverview({ service: serviceName, from, to })).byTool,
    });
  }
  return globalForContainer.__memtraceAssistantRegistry;
}

/** Gate de despliegue (ADR-064): solo lee runs, scores y score configs. */
export function getDeployGate(): DeployGateService {
  if (!globalForContainer.__memtraceDeployGate) {
    globalForContainer.__memtraceDeployGate = new DeployGateService(
      getIdentity().identityRepository,
      getScoreRepository(),
      new PostgresScoreConfigRepository(getPostgresPool()),
      (experimentId) => getDeployRuns().succeededShas(experimentId),
    );
  }
  return globalForContainer.__memtraceDeployGate;
}

function getDeployRuns(): PostgresDeployRunRepository {
  if (!globalForContainer.__memtraceDeployRuns) globalForContainer.__memtraceDeployRuns = new PostgresDeployRunRepository(getPostgresPool());
  return globalForContainer.__memtraceDeployRuns;
}

/** Despliegue desde MemTrace (ADR-064). Sin GitHub App en el entorno, el servicio existe pero responde 503 al lanzar. */
export function getDeploy(): DeployService {
  if (!globalForContainer.__memtraceDeploy) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const dispatcher = appId && privateKey ? new GithubAppDispatcher({ appId, privateKey }) : new UnconfiguredDispatcher();
    globalForContainer.__memtraceDeploy = new DeployService(getAssistantRegistry(), getDeployGate(), getDeployRuns(), dispatcher);
  }
  return globalForContainer.__memtraceDeploy;
}

function getPromptRepository(): PostgresPromptRepository {
  if (!globalForContainer.__memtracePromptRepository) globalForContainer.__memtracePromptRepository = new PostgresPromptRepository(getPostgresPool());
  return globalForContainer.__memtracePromptRepository;
}

function getPromptEvidenceRepository(): ClickHousePromptEvidenceRepository {
  if (!globalForContainer.__memtracePromptEvidenceRepository) {
    const config = configFromEnv();
    globalForContainer.__memtracePromptEvidenceRepository = new ClickHousePromptEvidenceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries);
  }
  return globalForContainer.__memtracePromptEvidenceRepository;
}

/** Gate de promoción de prompts y su política (ADR-070): evaluaciones de la versión, agregados y objetivos de las score configs. */
export function getPromptGate(): PromptGateService {
  if (!globalForContainer.__memtracePromptGate) {
    globalForContainer.__memtracePromptGate = new PromptGateService(
      getPromptRepository(),
      getIdentity().identityRepository,
      getScoreRepository(),
      new PostgresScoreConfigRepository(getPostgresPool()),
      getPromptEvidenceRepository(),
    );
  }
  return globalForContainer.__memtracePromptGate;
}

/** Catálogo de datos de las Custom charts: nombres y visibilidad de pasos y atributos por experimento (ADR-078). */
/** Registro de auditoría (ADR-080). Quien lee (`audit:read`) y quien escribe son la misma instancia. */
export function getAudit(): AuditService {
  if (!globalForContainer.__memtraceAudit) globalForContainer.__memtraceAudit = new AuditService(new PostgresAuditRepository(getPostgresPool()));
  return globalForContainer.__memtraceAudit;
}

/** Plazos de retención (ADR-080). La API solo los cambia; el borrado lo hace el CronJob `retention-purge`, que lleva su propio cliente. */
export function getRetention(): RetentionService {
  if (!globalForContainer.__memtraceRetention) globalForContainer.__memtraceRetention = new RetentionService(new PostgresRetentionRepository(getPostgresPool()), getAudit());
  return globalForContainer.__memtraceRetention;
}

/** Exportación de datos de un experimento (ADR-080). Lee con el cliente de solo lectura; la autorización (`data:export`) la decide la ruta. */
export function getExport(): ExportService {
  if (!globalForContainer.__memtraceExport) {
    const config = configFromEnv();
    globalForContainer.__memtraceExport = new ExportService(new ClickHouseDataExporter(createReadOnlyClient(config), config.database, config.maxConcurrentQueries), getAudit());
  }
  return globalForContainer.__memtraceExport;
}

export function getChartCatalog(): ChartCatalogService {
  if (!globalForContainer.__memtraceChartCatalog) globalForContainer.__memtraceChartCatalog = new ChartCatalogService(new PostgresChartCatalogRepository(getPostgresPool()));
  return globalForContainer.__memtraceChartCatalog;
}

function getApprovalRepository(): PostgresApprovalRepository {
  if (!globalForContainer.__memtraceApprovalRepository) globalForContainer.__memtraceApprovalRepository = new PostgresApprovalRepository(getPostgresPool());
  return globalForContainer.__memtraceApprovalRepository;
}

/** Aprobaciones de prompts (ADR-076): reglas por organización y experimento, solicitudes y decisiones. */
export function getApprovals(): ApprovalService {
  if (!globalForContainer.__memtraceApprovals) {
    globalForContainer.__memtraceApprovals = new ApprovalService(getApprovalRepository(), getPrompts(), getPromptRepository(), getPromptGate(), getIdentity().identityRepository);
  }
  return globalForContainer.__memtraceApprovals;
}

/** Mapa de dependencias de un prompt e impacto antes de promover (ADR-074). */
export function getPromptMap(): PromptMapService {
  if (!globalForContainer.__memtracePromptMap) globalForContainer.__memtracePromptMap = new PromptMapService(getPrompts(), getPromptRepository(), getIdentity().identityRepository);
  return globalForContainer.__memtracePromptMap;
}

/** Playground contra el asistente real (ADR-071): el chat del agente con un override efímero de la versión a probar. */
export function getPromptPlayground(): PromptPlaygroundService {
  if (!globalForContainer.__memtracePromptPlayground) {
    globalForContainer.__memtracePromptPlayground = new PromptPlaygroundService(getPromptRepository(), getAssistantRegistry(), getChatClient());
  }
  return globalForContainer.__memtracePromptPlayground;
}

/** Registro de prompts (ADR-067). Mover un tag de entorno pasa por el gate de promoción (ADR-070). */
export function getPrompts(): PromptService {
  if (!globalForContainer.__memtracePrompts) globalForContainer.__memtracePrompts = new PromptService(getPromptRepository(), getPromptGate(), getIdentity().identityRepository, new ApprovalRuleResolver(getApprovalRepository()));
  return globalForContainer.__memtracePrompts;
}

/** Evidencia por versión de un prompt (ADR-069): trazas, feedback y scores, con los precios del catálogo. */
export function getPromptEvidence(): PromptEvidenceService {
  if (!globalForContainer.__memtracePromptEvidence) {
    globalForContainer.__memtracePromptEvidence = new PromptEvidenceService(getPromptEvidenceRepository(), () => getTraceQueryService().getPricingCatalog());
  }
  return globalForContainer.__memtracePromptEvidence;
}

/** Fallos recientes de un prompt (ADR-078): errores, scores bajos, etiquetas humanas negativas y 👎 cruzados por traza. */
export function getPromptFailures(): PromptFailureService {
  if (!globalForContainer.__memtracePromptFailures) {
    const config = configFromEnv();
    globalForContainer.__memtracePromptFailures = new PromptFailureService(
      getTraceRepository(),
      getScoreRepository(),
      new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database, config.maxConcurrentQueries),
      getAnnotation(),
    );
  }
  return globalForContainer.__memtracePromptFailures;
}

/** Sondeo de /health para «Comprobar ahora»; mismo adapter y mismas reglas SSRF que el worker. */
export function getHealthProber(): HealthProber {
  if (!globalForContainer.__memtraceHealthProber) {
    globalForContainer.__memtraceHealthProber = new HttpHealthProber({
      timeoutMs: Number(process.env.HEALTH_PROBE_TIMEOUT_MS ?? 5000),
      allowPrivateNetworks: process.env.HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS === "true",
    });
  }
  return globalForContainer.__memtraceHealthProber;
}

/** Cliente del chat de los asistentes (ADR-055); mismas reglas SSRF que el sondeo de /health. */
export function getChatClient(): ChatClient {
  if (!globalForContainer.__memtraceChatClient) {
    globalForContainer.__memtraceChatClient = new HttpChatClient({
      timeoutMs: Number(process.env.CHAT_TIMEOUT_MS ?? 60_000),
      allowPrivateNetworks: process.env.HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS === "true",
    });
  }
  return globalForContainer.__memtraceChatClient;
}
