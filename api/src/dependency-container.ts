/** Composition root: único sitio donde se eligen los adapters concretos y se lee el entorno. */
import { TraceQueryService } from "@/application/trace-query-service";
import { createHandlers, type Handlers } from "@/adapters/inbound/http/handlers";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { configFromEnv, createReadOnlyClient, createScoresWriteClient } from "@/adapters/outbound/clickhouse/client";
import { AuthorizationService } from "@/application/authorization-service";
import { EvaluationService } from "@/application/evaluation-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { configFromEnv as postgresConfigFromEnv, createPool } from "@/adapters/outbound/postgres/client";
import type { EmailSender } from "@/application/ports/email-sender";
import { NoopEmailSender, ResendEmailSender } from "@/adapters/outbound/email/resend-email-sender";

// En `next dev` los módulos se recargan: el contenedor se cachea en globalThis para no abrir conexiones nuevas
const globalForContainer = globalThis as unknown as {
  __memtraceHandlers?: Handlers;
  __memtraceIdentity?: { identityRepository: IdentityRepository; authorizationService: AuthorizationService; emailSender: EmailSender };
  __memtraceEvaluation?: EvaluationService;
  __memtraceScoreRepository?: ClickHouseScoreRepository;
};

function getScoreRepository(): ClickHouseScoreRepository {
  if (!globalForContainer.__memtraceScoreRepository) {
    const config = configFromEnv();
    globalForContainer.__memtraceScoreRepository = new ClickHouseScoreRepository(createScoresWriteClient(config), createReadOnlyClient(config), config.database);
  }
  return globalForContainer.__memtraceScoreRepository;
}

export function getHandlers(): Handlers {
  if (!globalForContainer.__memtraceHandlers) {
    const config = configFromEnv();
    const repository = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries);
    globalForContainer.__memtraceHandlers = createHandlers(new TraceQueryService(repository));
  }
  return globalForContainer.__memtraceHandlers;
}

export function getIdentity(): { identityRepository: IdentityRepository; authorizationService: AuthorizationService; emailSender: EmailSender } {
  if (!globalForContainer.__memtraceIdentity) {
    const identityRepository = new PostgresIdentityRepository(createPool(postgresConfigFromEnv()));
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
