import { auth } from "@/auth";
import { getAudit, getIdentity, getPrompts } from "@/dependency-container";
import type { User } from "@/domain/identity";
import type { Permission } from "@/domain/permissions";
import type { Prompt } from "@/domain/prompt";
import type { TenantScope } from "@/domain/tenant";
import { problem } from "./problem";

/** Resuelve el usuario de dominio (tabla `users`) a partir de la sesión de Auth.js, o un 401. */
export async function requireUser(): Promise<User | Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return problem(401, "Unauthorized", "Login required");

  const { identityRepository } = getIdentity();
  const user = await identityRepository.getUserByEmail(email);
  if (!user) return problem(401, "Unauthorized", "Login required");
  return user;
}

/** Sesión + permiso sobre el experimento (ADR-052): `ctx` o una `Response` de error lista para devolver desde la route. */
export interface ExperimentContext {
  user: User;
  /** Frontera de aislamiento de los datos (ADR-077), construida desde el experimento, nunca desde la petición. */
  scope: TenantScope;
  serviceName: string;
  /** etiqueta del rol; para decidir qué se puede hacer, usar `permissions` */
  role: string;
  permissions: Permission[];
}

/**
 * Exige un permiso concreto sobre el experimento. 401 sin sesión, 404 si no existe, 403 si no tiene ningún acceso o
 * le falta el permiso.
 */
export async function requirePermission(experimentId: string, permission: Permission): Promise<ExperimentContext | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { identityRepository, authorizationService } = getIdentity();
  const experiment = await identityRepository.getExperiment(experimentId);
  if (!experiment) return problem(404, "Not Found", "Experiment not found");

  const access = await authorizationService.resolveExperimentAccess(user.id, experimentId);
  if (access === null) return problem(403, "Forbidden", "No access to this experiment");
  if (!access.permissions.includes(permission)) return problem(403, "Forbidden", `Missing permission: ${permission}`);
  // una consultora entrando en los datos de un cliente deja rastro que el cliente puede leer (ADR-080, ADR-082)
  if (access.viaPartner) await getAudit().recordPartnerAccess({ userId: user.id, email: user.email }, { id: experiment.id, organizationId: experiment.organizationId });
  return { user, scope: { experimentId: experiment.id, serviceName: experiment.serviceName }, serviceName: experiment.serviceName, role: access.role, permissions: access.permissions };
}

/** Sesión + `org:manage` sobre la organización: ajustes de identidad externa, mapeos y tokens SCIM (ADR-052). */
export async function requireOrgAdmin(organizationId: string): Promise<User | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await getIdentity().authorizationService.canManageOrganization(user.id, organizationId))) {
    return problem(403, "Forbidden", "Missing permission: org:manage");
  }
  return user;
}

/** Lectura del dashboard (`experiment:read`); devuelve solo lo que necesitan las rutas de consulta. */
export async function requireExperimentRead(experimentId: string): Promise<{ serviceName: string; scope: TenantScope } | Response> {
  const ctx = await requirePermission(experimentId, "experiment:read");
  return ctx instanceof Response ? ctx : { serviceName: ctx.serviceName, scope: ctx.scope };
}

/**
 * Igual que `requireExperimentRead`, pero acepta también una API key de agente por `Authorization:
 * Bearer` (ADR-028) — reutiliza `resolveApiKey`, el mismo mecanismo ya validado en el gateway de
 * ingesta OTLP (`ingest/v1/traces/route.ts`). Para los endpoints de evaluación (`/datasets/...`),
 * a los que un agente sin dashboard también necesita poder escribir (crear su propio dataset,
 * subir una ejecución) además de leer, a diferencia del resto de la API que es solo-sesión.
 *
 * `createdByUserId` es quien queda como autor de lo creado vía esta ruta: el usuario de la sesión,
 * o quien creó la API key si no hay sesión (un agente no tiene usuario propio).
 */
export async function requireExperimentAccess(experimentId: string, request: Request, writePermission: Permission = "dataset:write"): Promise<{ serviceName: string; scope: TenantScope; createdByUserId: string } | Response> {
  const { identityRepository } = getIdentity();
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const access = await identityRepository.resolveApiKey(bearer);
    if (!access) return problem(401, "Unauthorized", "Invalid or revoked API key");
    if (access.experimentId !== experimentId) return problem(403, "Forbidden", "API key does not belong to this experiment");
    return { serviceName: access.serviceName, scope: { experimentId: access.experimentId, serviceName: access.serviceName }, createdByUserId: access.createdByUserId };
  }

  const ctx = await requirePermission(experimentId, request.method === "GET" || request.method === "HEAD" ? "experiment:read" : writePermission);
  if (ctx instanceof Response) return ctx;
  return { serviceName: ctx.serviceName, scope: ctx.scope, createdByUserId: ctx.user.id };
}

/**
 * Sesión + al menos uno de los permisos sobre el experimento. Para el registro de asistentes (ADR-053), donde dos perfiles
 * llegan por caminos distintos: el dueño técnico (`assistant:manage`, de su experimento) y gobernanza (`governance:*`, de su
 * rol de organización, que `resolveExperimentAccess` ya une a los del experimento).
 */
export async function requireAnyPermission(experimentId: string, permissions: Permission[]): Promise<ExperimentContext | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { identityRepository, authorizationService } = getIdentity();
  const experiment = await identityRepository.getExperiment(experimentId);
  if (!experiment) return problem(404, "Not Found", "Experiment not found");

  const access = await authorizationService.resolveExperimentAccess(user.id, experimentId);
  if (access === null) return problem(403, "Forbidden", "No access to this experiment");
  if (!permissions.some((p) => access.permissions.includes(p))) return problem(403, "Forbidden", `Missing permission: ${permissions.join(" or ")}`);
  if (access.viaPartner) await getAudit().recordPartnerAccess({ userId: user.id, email: user.email }, { id: experiment.id, organizationId: experiment.organizationId });
  return { user, scope: { experimentId: experiment.id, serviceName: experiment.serviceName }, serviceName: experiment.serviceName, role: access.role, permissions: access.permissions };
}

/** Sesión + un permiso concedido por el rol de organización (catálogo de asistentes, ADR-053). */
export async function requireOrganizationPermission(organizationId: string, permission: Permission): Promise<User | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, permission))) {
    return problem(403, "Forbidden", `Missing permission: ${permission}`);
  }
  return user;
}

/**
 * ¿Puede esta persona hacer `permission` sobre el prompt? (ADR-067). El prompt es de la organización, así que vale el
 * rol de organización; y como puede pertenecer a varios agentes, vale también el rol sobre cualquiera de ellos.
 */
async function canOnPrompt(userId: string, prompt: Prompt, permission: Permission): Promise<boolean> {
  const { authorizationService } = getIdentity();
  if (await authorizationService.canInOrganization(userId, prompt.organizationId, permission)) return true;
  for (const experimentId of prompt.experimentIds) {
    if (await authorizationService.can(userId, experimentId, permission)) return true;
  }
  return false;
}

/** Sesión + permiso sobre el prompt: 404 si no existe, 403 si no tiene el permiso. Devuelve además si puede promover (mover tags de entorno). */
export async function requirePromptPermission(promptId: string, permission: Permission): Promise<{ user: User; prompt: Prompt; canPromote: boolean } | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const prompt = await getPrompts().get(promptId);
  if (!(await canOnPrompt(user.id, prompt, permission))) return problem(403, "Forbidden", `Missing permission: ${permission}`);
  const canPromote = permission === "prompt:promote" || (await canOnPrompt(user.id, prompt, "prompt:promote"));
  return { user, prompt, canPromote };
}

/** Quién puede ver la ficha de un asistente, quién puede editarla y quién decide sobre conexiones y accesos (ADR-053). */
export const ASSISTANT_READ: Permission[] = ["governance:read", "assistant:manage"];
export const ASSISTANT_WRITE: Permission[] = ["assistant:manage", "governance:manage"];
export const ASSISTANT_GOVERN: Permission[] = ["governance:manage"];
/** Quién puede lanzar un despliegue desde MemTrace (ADR-064). Saltarse el gate exige además `governance:manage`. */
export const DEPLOY_RUN: Permission[] = ["deploy:run", "governance:manage"];
