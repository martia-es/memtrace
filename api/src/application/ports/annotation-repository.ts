import type { TenantScope } from "@/domain/tenant";
import type { Annotation } from "@/domain/annotation";

/** Puerto hacia el almacén de anotaciones (ClickHouse, ADR-037). Una fila por (objetivo, span, config, anotador). */
export interface AnnotationRepository {
  /** Inserta (o sustituye, si ya existía la misma clave) la anotación. `createdAt` lo fija el llamador (reloj del servidor). */
  upsert(scope: TenantScope, annotation: Annotation): Promise<void>;
  /** Inserta la lápida de una anotación (misma clave, `IsDeleted = 1`, `createdAt` posterior). `comment` deja constancia de quién la retiró. */
  retract(scope: TenantScope, annotation: Annotation): Promise<void>;
  /** Anotaciones vigentes (sin retiradas) de una traza, de todos los anotadores. */
  listForTrace(scope: TenantScope, traceId: string): Promise<Annotation[]>;
  /** Anotaciones vigentes de items de run (`TargetType = 'run_item'`) de esos runs, de todos los anotadores (ADR-040). `configName` filtra por rúbrica. */
  listForRuns(scope: TenantScope, datasetRunIds: string[], configName?: string): Promise<Annotation[]>;
  /** Etiquetas vigentes sobre trazas enteras creadas en el rango, las más recientes primero, hasta `limit` (ADR-049). */
  listRecentForTraces(scope: TenantScope, fromMs: number, toMs: number, limit: number): Promise<Annotation[]>;
  /** Anotaciones vigentes sobre la traza entera (no sobre un span) de esas trazas, de todos los anotadores (ADR-040). */
  listForTraces(scope: TenantScope, traceIds: string[], configName?: string): Promise<Annotation[]>;
}
