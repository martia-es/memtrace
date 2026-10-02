import { auth } from "@/auth";
import { getIdentity } from "@/dependency-container";
import type { User } from "@/domain/identity";
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
