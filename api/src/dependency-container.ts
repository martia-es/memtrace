/** Composition root: único sitio donde se eligen los adapters concretos y se lee el entorno. */
import { TraceQueryService } from "@/application/trace-query-service";
import { createHandlers, type Handlers } from "@/adapters/inbound/http/handlers";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseAnnotationRepository } from "@/adapters/outbound/clickhouse/clickhouse-annotation-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { configFromEnv, createReadOnlyClient, createEvaluationWriteClient } from "@/adapters/outbound/clickhouse/client";
import { AuthorizationService } from "@/application/authorization-service";
import { AnnotationQueueService } from "@/application/annotation-queue-service";
import { PostgresAnnotationQueueRepository } from "@/adapters/outbound/postgres/postgres-annotation-queue-repository";
import { AgreementService } from "@/application/agreement-service";
import { AnnotationService } from "@/application/annotation-service";
import { EvaluationService } from "@/application/evaluation-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
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
  __memtraceEvaluation?: EvaluationService;
  __memtraceScoreRepository?: ClickHouseScoreRepository;
  __memtracePostgresPool?: Pool;
  __memtraceAnnotation?: AnnotationService;
  __memtraceAnnotationQueue?: AnnotationQueueService;
  __memtraceAgreement?: AgreementService;
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
