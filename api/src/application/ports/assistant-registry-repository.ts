import type {
  AccessGrant,
  AssistantPerson,
  AssistantCard,
  AssistantPatch,
  Connection,
  ConnectionStatus,
  DeclaredConnection,
  Deployment,
  DeploymentPatch,
  Environment,
  HealthCheck,
  HealthStatus,
  NewDeployment,
  NewGrant,
  ObservedConnection,
  ProbeResult,
  ProbeTarget,
} from "@/domain/assistant-registry";

/**
 * Almacén del registro de asistentes (ADR-053). PostgreSQL: lo declarado, el estado de gobernanza y el estado de salud.
 * Las métricas observadas (llamadas, errores) NO están aquí: salen de ClickHouse al consultar.
 * Las operaciones sobre un despliegue o una conexión reciben siempre el experimento, para que un id ajeno sea «no existe».
 */
export interface AssistantRegistryRepository {
  listEnvironments(organizationId: string): Promise<Environment[]>;

  /** Todos los experimentos de la organización: cada experimento es un agente (ADR-054). */
  listCatalog(organizationId: string): Promise<AssistantCard[]>;
  getCard(experimentId: string): Promise<AssistantCard | null>;
  /** Devuelve null si el experimento no existe. */
  update(experimentId: string, patch: AssistantPatch): Promise<AssistantCard | null>;

  /** Lanza `AssistantInvariantError` si el entorno no existe en la organización o ya hay un despliegue en él. */
  createDeployment(experimentId: string, input: NewDeployment): Promise<Deployment>;
  getDeployment(experimentId: string, deploymentId: string): Promise<Deployment | null>;
  updateDeployment(experimentId: string, deploymentId: string, patch: DeploymentPatch): Promise<Deployment | null>;
  deleteDeployment(experimentId: string, deploymentId: string): Promise<boolean>;

  /** null si el despliegue no es de ese experimento. Más reciente primero. */
  listHealthChecks(experimentId: string, deploymentId: string, since: Date, limit: number): Promise<HealthCheck[] | null>;
  /** Despliegues a los que les toca sondeo (activos, con sondeo habilitado y vencido su intervalo). */
  listDueDeployments(now: Date, limit: number): Promise<ProbeTarget[]>;
  /** Guarda el sondeo en el historial y actualiza el estado actual (con la regla de fallos seguidos). Devuelve el estado antes y después. */
  recordProbe(deploymentId: string, result: ProbeResult, checkedAt: Date): Promise<{ previous: HealthStatus; current: HealthStatus } | null>;
  /** Borra el historial anterior a `before`; devuelve cuántas filas. */
  pruneHealthChecks(before: Date): Promise<number>;

  /** Experimentos activos con su clave de tenant en ClickHouse: lo que recorre la sincronización de conexiones observadas. */
  listActiveExperiments(): Promise<Array<{ experimentId: string; serviceName: string }>>;
  listConnections(experimentId: string): Promise<Connection[]>;
  /** Marca la conexión como declarada (la crea si no existía). */
  declareConnection(experimentId: string, input: DeclaredConnection): Promise<Connection>;
  /** Quita la declaración: la fila desaparece si nunca se vio en trazas; si no, queda como solo observada. false si no existe. */
  undeclareConnection(experimentId: string, connectionId: string): Promise<boolean>;
  decideConnection(experimentId: string, connectionId: string, status: ConnectionStatus, decidedBy: string, note: string | null): Promise<Connection | null>;
  /** Registra lo visto en trazas: crea lo nuevo como `pending` y actualiza `first_seen_at` / `last_seen_at`. */
  recordObservedConnections(experimentId: string, observed: ObservedConnection[], seenAt: Date): Promise<void>;

  /** null si el despliegue no es de ese experimento. */
  listGrants(experimentId: string, deploymentId: string): Promise<AccessGrant[] | null>;
  /** Lanza `AssistantInvariantError` si ya existe ese acceso. null si el despliegue no es de ese experimento. */
  addGrant(experimentId: string, deploymentId: string, grant: NewGrant, createdBy: string): Promise<AccessGrant | null>;
  removeGrant(experimentId: string, deploymentId: string, grantId: string): Promise<boolean>;
  /** Personas de la organización del experimento cuyo nombre o email contiene `query`, por nombre. null si el experimento no existe. */
  searchPeople(experimentId: string, query: string, limit: number): Promise<AssistantPerson[] | null>;
}
