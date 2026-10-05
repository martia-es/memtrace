/**
 * Acceso gestionado por el proveedor de identidad del cliente (ADR-052, fases B y C): un grupo externo (claim `groups`
 * del token OIDC o grupo SCIM) se traduce a un rol nuestro. Todo lo de este archivo es puro.
 */

export type MembershipSource = "manual" | "oidc" | "scim";
/** Origen de una membresía gestionada desde fuera; las `manual` nunca las toca la conciliación. */
export type ExternalSource = Exclude<MembershipSource, "manual">;

/** Qué grupo externo da qué rol. `experimentId` null = rol de organización. */
export interface ExternalMapping {
  id: string;
  organizationId: string;
  externalGroup: string;
  experimentId: string | null;
  role: string;
  createdAt: string;
}

/** Un rol que la conciliación debe dejar asignado: en un experimento, o en la organización si `experimentId` es null. */
export interface ExternalGrant {
  experimentId: string | null;
  role: string;
}

/**
 * Lee la lista de grupos de las claims del token. Devuelve `null` cuando la claim no viene (Google no la manda, o
 * Entra la omite por exceso de grupos y manda `_claim_names`): en ese caso NO se concilia, para no quitar accesos por
 * un token incompleto. Una lista vacía sí es información (la persona ya no está en ningún grupo).
 */
export function readGroupsClaim(claims: Record<string, unknown> | null | undefined, claimName: string): string[] | null {
  if (!claims) return null;
  const value = claims[claimName];
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === "string" && g.length > 0);
  if (typeof value === "string" && value.length > 0) return [value];
  const overage = claims["_claim_names"];
  if (overage && typeof overage === "object" && claimName in (overage as Record<string, unknown>)) return null;
  return value === undefined ? null : [];
}

/**
 * Roles que corresponden a una persona dado su conjunto de grupos. Si varios grupos dan un rol distinto en el mismo
 * destino (solo cabe uno por persona y destino) gana el de más permisos, que es el comportamiento esperable
 * (`technical` incluye todo lo de `business`).
 */
export function desiredGrants(mappings: ExternalMapping[], groups: Iterable<string>, roleWeight: (role: string) => number = () => 0): ExternalGrant[] {
  const owned = new Set(groups);
  const byTarget = new Map<string, ExternalGrant>();
  for (const m of mappings) {
    if (!owned.has(m.externalGroup)) continue;
    const key = m.experimentId ?? "organization";
    const current = byTarget.get(key);
    if (!current || roleWeight(m.role) > roleWeight(current.role)) byTarget.set(key, { experimentId: m.experimentId, role: m.role });
  }
  return [...byTarget.values()];
}
