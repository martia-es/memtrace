import { auth } from "@/auth";
import { getIdentity } from "@/dependency-container";
import type { ExperimentAccess, User } from "@/domain/identity";
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

/**
 * Resuelve sesión + acceso al experimento para un route handler (ADR-013).
 * Devuelve `{ serviceName }` si el usuario puede leer el experimento, o una `Response` de error lista para
 * devolver tal cual desde la route.
 */
export async function requireExperimentRead(experimentId: string): Promise<{ serviceName: string } | Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return problem(401, "Unauthorized", "Login required");

  const { identityRepository, authorizationService } = getIdentity();
  const user = await identityRepository.getUserByEmail(email);
  if (!user) return problem(401, "Unauthorized", "Login required");

  const experiment = await identityRepository.getExperiment(experimentId);
  if (!experiment) return problem(404, "Not Found", "Experiment not found");

  const access = await authorizationService.resolveExperimentAccess(user.id, experimentId);
  if (access === null) return problem(403, "Forbidden", "No access to this experiment");

  return { serviceName: experiment.serviceName };
}

/**
 * Sesión humana + rol en el experimento: para lo que se atribuye a una persona (anotaciones, ADR-037) y por
 * tanto no admite API key. `access` distingue admin/org_admin de member.
 */
export async function requireExperimentMember(
  experimentId: string,
): Promise<{ user: User; serviceName: string; access: NonNullable<ExperimentAccess> } | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { identityRepository, authorizationService } = getIdentity();
  const experiment = await identityRepository.getExperiment(experimentId);
  if (!experiment) return problem(404, "Not Found", "Experiment not found");

  const access = await authorizationService.resolveExperimentAccess(user.id, experimentId);
  if (access === null) return problem(403, "Forbidden", "No access to this experiment");
  return { user, serviceName: experiment.serviceName, access };
}

/** Como `requireExperimentMember`, pero exige admin del experimento u org_admin (gestión de colas, ADR-039). */
export async function requireExperimentAdmin(experimentId: string): Promise<Awaited<ReturnType<typeof requireExperimentMember>>> {
  const ctx = await requireExperimentMember(experimentId);
  if (ctx instanceof Response) return ctx;
  if (ctx.access !== "admin" && ctx.access !== "org_admin") return problem(403, "Forbidden", "Only experiment admins can manage annotation queues");
  return ctx;
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
export async function requireExperimentAccess(experimentId: string, request: Request): Promise<{ serviceName: string; createdByUserId: string } | Response> {
  const { identityRepository, authorizationService } = getIdentity();
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const access = await identityRepository.resolveApiKey(bearer);
    if (!access) return problem(401, "Unauthorized", "Invalid or revoked API key");
    if (access.experimentId !== experimentId) return problem(403, "Forbidden", "API key does not belong to this experiment");
    return { serviceName: access.serviceName, createdByUserId: access.createdByUserId };
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return problem(401, "Unauthorized", "Login required");
  const user = await identityRepository.getUserByEmail(email);
  if (!user) return problem(401, "Unauthorized", "Login required");

  const experiment = await identityRepository.getExperiment(experimentId);
  if (!experiment) return problem(404, "Not Found", "Experiment not found");

  const access = await authorizationService.resolveExperimentAccess(user.id, experimentId);
  if (access === null) return problem(403, "Forbidden", "No access to this experiment");

  return { serviceName: experiment.serviceName, createdByUserId: user.id };
}

/** Sustituye/añade `service` en la query string de la request, forzando el scoping por experimento. */
export function withServiceFilter(request: Request, serviceName: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("service", serviceName);
  return new Request(url, request);
}
