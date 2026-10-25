import type { SecurityEventRow } from "@/domain/agent-security";
import type { TenantScope } from "@/domain/tenant";
import type { TimeRange } from "@/domain/time-range";

/**
 * Modelo de lectura de la postura de seguridad (ADR-103): los spans `security.*` que emiten los detectores del SDK, ya
 * contados. Nunca devuelve texto detectado (el SDK no lo guarda). ClickHouse. Lanza `RepositoryUnavailableError` si el almacén no responde.
 */
export interface SecurityEventRepository {
  /** Solo detecciones (`security.detected = true`), sin las trazas del playground (ADR-071). */
  countEvents(query: TimeRange & { scope: TenantScope }): Promise<SecurityEventRow[]>;
  /** Detecciones en una ventana corta (las alertas, ADR-086), filtradas por detector y severidad; `blockedOnly` cuenta solo las que cortaron la ejecución. */
  countInWindow(query: TimeRange & { scope: TenantScope; detector: string | null; severity: string | null; blockedOnly: boolean }): Promise<number>;
}
