import type { AccessGrant, AssistantCard, ConnectionWithUsage, Deployment, Environment, HealthCheck } from "@/domain/assistant-registry";
import type {
  AccessGrantDto,
  AssistantCardDto,
  ConnectionDto,
  DeploymentDto,
  EnvironmentDto,
  HealthCheckDto,
} from "./contract";

// Los tipos del dominio ya encajan con el contrato; estas funciones fijan esa compatibilidad en compilación
// y son el único sitio donde, si un campo interno no debe salir, se quita.

export const toAssistantCardDto = (c: AssistantCard): AssistantCardDto => c;
export const toDeploymentDto = (d: Deployment): DeploymentDto => d;
export const toEnvironmentDto = (e: Environment): EnvironmentDto => ({
  id: e.id,
  key: e.key,
  label: e.label,
  position: e.position,
  isProduction: e.isProduction,
  healthIntervalSeconds: e.healthIntervalSeconds,
});
export const toHealthCheckDto = (h: HealthCheck): HealthCheckDto => ({
  checkedAt: h.checkedAt,
  status: h.status,
  latencyMs: h.latencyMs,
  httpStatus: h.httpStatus,
  error: h.error,
});
export const toConnectionDto = (c: ConnectionWithUsage): ConnectionDto => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  via: c.via,
  peerExperimentId: c.peerExperimentId,
  declared: c.declared,
  status: c.status,
  firstSeenAt: c.firstSeenAt,
  lastSeenAt: c.lastSeenAt,
  decidedBy: c.decidedBy,
  decidedAt: c.decidedAt,
  note: c.note,
  usage: c.usage,
});
export const toAccessGrantDto = (g: AccessGrant): AccessGrantDto => g;
