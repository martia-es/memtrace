import type {
  AccessGrantDto,
  AssistantPersonDto,
  AssistantCardDto,
  AuthMethodDto,
  ChatConfigDto,
  ChatResponseDto,
  ConnectionDto,
  ConnectionKindDto,
  ConnectionStatusDto,
  DeployPreviewDto,
  DeployRunDto,
  DeploymentDto,
  EnvironmentDto,
  GrantSubjectTypeDto,
  HealthCheckDto,
  RepoConfigDto,
} from "@contract";

/** Puerto de salida: registro de asistentes para gobernanza (ADR-053). Otro dominio que trazas e identidad. */

export interface AssistantPatchInput {
  description?: string;
  ownerUserId?: string | null;
  lifecycle?: "active" | "retired";
  /** null quita el endpoint de chat */
  chat?: ChatConfigDto | null;
  /** null quita el repositorio */
  repo?: RepoConfigDto | null;
}

export interface DeploymentInput {
  apiUrl: string;
  healthUrl: string | null;
  version: string | null;
  deployRef: string | null;
  authMethod: AuthMethodDto;
  authProvider: string | null;
  authAudience: string | null;
  healthCheckEnabled: boolean;
  healthIntervalSeconds: number | null;
}

export interface NewGrantInput {
  subjectType: GrantSubjectTypeDto;
  userId?: string | null;
  externalGroup?: string | null;
  memberCount?: number | null;
}

export interface AssistantApi {
  listCatalog(organizationId: string, signal?: AbortSignal): Promise<AssistantCardDto[]>;
  /** Todo experimento tiene ficha: un experimento es un agente (ADR-054). */
  getAssistant(experimentId: string, signal?: AbortSignal): Promise<AssistantCardDto>;
  updateAssistant(experimentId: string, patch: AssistantPatchInput, signal?: AbortSignal): Promise<AssistantCardDto>;

  listEnvironments(experimentId: string, signal?: AbortSignal): Promise<EnvironmentDto[]>;
  createDeployment(experimentId: string, environmentKey: string, input: DeploymentInput, signal?: AbortSignal): Promise<DeploymentDto>;
  updateDeployment(experimentId: string, deploymentId: string, patch: Partial<DeploymentInput>, signal?: AbortSignal): Promise<DeploymentDto>;
  deleteDeployment(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<void>;
  /** Habla con el agente en un entorno, a través del proxy de la API (ADR-055). */
  chat(experimentId: string, deploymentId: string, message: string, sessionId: string | null, signal?: AbortSignal): Promise<ChatResponseDto>;
  /** 👍 (1) / 👎 (-1) de quien prueba el chat sobre la traza de una respuesta (ADR-062). Con sesión, el voto es de quien está conectado. */
  sendFeedback(experimentId: string, traceId: string, rating: 1 | -1, signal?: AbortSignal): Promise<void>;
  /** Qué se desplegaría ahora en un entorno (rama → commit) y si el gate lo permite (ADR-064). */
  previewDeploy(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeployPreviewDto>;
  /** Dispara el CI del repo del agente. `bypassReason` solo para saltarse el gate (exige permiso de gobernanza). */
  deploy(experimentId: string, deploymentId: string, bypassReason: string | null, signal?: AbortSignal): Promise<DeployRunDto>;
  listDeploys(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeployRunDto[]>;
  /** Sondea /health ahora; si se comprobó hace menos de 10 s devuelve el estado actual. */
  checkDeploymentNow(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeploymentDto>;
  getHealthHistory(experimentId: string, deploymentId: string, hours: number, signal?: AbortSignal): Promise<HealthCheckDto[]>;

  listGrants(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<AccessGrantDto[]>;
  addGrant(experimentId: string, deploymentId: string, input: NewGrantInput, signal?: AbortSignal): Promise<AccessGrantDto>;
  removeGrant(experimentId: string, deploymentId: string, grantId: string, signal?: AbortSignal): Promise<void>;
  /** Personas de la organización cuyo nombre o email contiene `query` (vacío = las primeras por nombre). */
  searchPeople(experimentId: string, query: string, signal?: AbortSignal): Promise<AssistantPersonDto[]>;

  listConnections(experimentId: string, signal?: AbortSignal): Promise<ConnectionDto[]>;
  declareConnection(experimentId: string, input: { kind: ConnectionKindDto; name: string; via?: string | null }, signal?: AbortSignal): Promise<ConnectionDto>;
  decideConnection(experimentId: string, connectionId: string, status: ConnectionStatusDto, note: string | null, signal?: AbortSignal): Promise<ConnectionDto>;
  undeclareConnection(experimentId: string, connectionId: string, signal?: AbortSignal): Promise<void>;
  /** Registra en el catálogo las tools vistas en trazas. */
  syncConnections(experimentId: string, signal?: AbortSignal): Promise<{ observed: number }>;
}
