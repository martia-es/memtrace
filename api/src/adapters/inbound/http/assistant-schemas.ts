import { z } from "zod";

/** Cuerpos de las rutas del registro de asistentes (ADR-053). Las reglas de negocio (URL sondeable, intervalo mínimo…) las valida el dominio. */

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();

const jsonKey = text(100).min(1);

export const chatConfigBody = z.object({
  path: text(300).min(1),
  requestField: jsonKey.default("message"),
  responseField: jsonKey.default("reply"),
  sessionField: jsonKey.nullable().default(null),
  traceIdField: jsonKey.nullable().default(null),
});

export const repoConfigBody = z.object({
  url: text(500).min(1),
  provider: z.enum(["github", "gitlab", "bitbucket"]),
  deployWorkflow: nullableText(200).default(null),
});

export const updateAssistantBody = z
  .object({
    description: text(2000),
    ownerUserId: z.string().uuid().nullable(),
    lifecycle: z.enum(["active", "retired"]),
    /** null quita el endpoint de chat */
    chat: chatConfigBody.nullable(),
    /** null quita el repositorio */
    repo: repoConfigBody.nullable(),
  })
  .partial();

export const deployBody = z.object({
  /** solo para saltarse el gate (hotfix): el motivo queda en el historial */
  bypassReason: z.string().max(500).nullable().default(null),
});

export const chatBody = z.object({
  message: z.string().min(1).max(8000),
  sessionId: text(200).min(1).nullable().default(null),
});

const authMethod = z.enum(["none", "api_key", "oauth2", "mtls", "other"]);

export const createDeploymentBody = z.object({
  environmentKey: z.string().min(1).max(32),
  apiUrl: z.string().trim().min(1).max(2000),
  healthUrl: nullableText(2000).default(null),
  version: nullableText(100).default(null),
  deployRef: nullableText(200).default(null),
  authMethod: authMethod.default("none"),
  authProvider: nullableText(200).default(null),
  authAudience: nullableText(500).default(null),
  healthCheckEnabled: z.boolean().default(true),
  healthIntervalSeconds: z.number().int().nullable().default(null),
});

export const updateDeploymentBody = z
  .object({
    apiUrl: text(2000).min(1),
    healthUrl: nullableText(2000),
    version: nullableText(100),
    deployRef: nullableText(200),
    authMethod,
    authProvider: nullableText(200),
    authAudience: nullableText(500),
    healthCheckEnabled: z.boolean(),
    healthIntervalSeconds: z.number().int().nullable(),
  })
  .partial();

export const declareConnectionBody = z.object({
  kind: z.enum(["mcp_server", "tool", "agent"]),
  name: text(300).min(1),
  via: nullableText(300).optional(),
  peerExperimentId: z.string().uuid().nullable().optional(),
});

export const decideConnectionBody = z.object({
  status: z.enum(["pending", "approved", "blocked"]),
  note: nullableText(1000).default(null),
});

export const addGrantBody = z.object({
  subjectType: z.enum(["user", "group", "everyone"]),
  userId: z.string().uuid().nullable().optional(),
  externalGroup: nullableText(300).optional(),
  memberCount: z.number().int().min(0).nullable().optional(),
});
