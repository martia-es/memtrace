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

/** Sustituye/añade `service` en la query string de la request, forzando el scoping por experimento. */
export function withServiceFilter(request: Request, serviceName: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("service", serviceName);
  return new Request(url, request);
}
