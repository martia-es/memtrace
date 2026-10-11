import type { BreakdownGroup, BreakdownRows } from "@/domain/breakdown";
import type { TenantScope } from "@/domain/tenant";
import type { TimeRange } from "@/domain/time-range";

/**
 * Modelo de lectura de Overview › Breakdown: trazas agrupadas por versión de prompt o por entorno, con tokens por modelo
 * (el servicio les pone precio), la serie diaria de errores y el feedback del usuario final. ClickHouse.
 * Lanza `RepositoryUnavailableError` si el almacén no responde.
 */
export interface BreakdownRepository {
  /** Las trazas del servicio en el rango, sin las del playground (ADR-071). Los grupos sin trazas no aparecen. */
  rowsFor(query: TimeRange & { scope: TenantScope; groupBy: BreakdownGroup }): Promise<BreakdownRows>;
}
