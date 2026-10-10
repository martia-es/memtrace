/**
 * Frontera de aislamiento de los datos (ADR-077). Todo acceso al almacén analítico recibe un `TenantScope` obligatorio:
 * el experimento es el tenant, y el `serviceName` solo ayuda a ClickHouse a podar por la clave primaria. Nunca se
 * construye a partir de lo que envía el cliente, sino de la sesión o de la API key (`requirePermission`, `resolveApiKey`).
 */
export interface TenantScope {
  readonly experimentId: string;
  readonly serviceName: string;
}

/** Falla cerrado: un scope sin experimento casaría con las filas anteriores a la migración 013 (que valen ''). */
export function assertTenantScope(scope: TenantScope): TenantScope {
  if (!scope || !scope.experimentId || !scope.serviceName) throw new Error("A tenant scope with experimentId and serviceName is required");
  return scope;
}

/** El scope de cualquier cosa que ya lleve experimento y servicio (un "actor" de un caso de uso). */
export function tenantOf(source: TenantScope): TenantScope {
  return { experimentId: source.experimentId, serviceName: source.serviceName };
}
