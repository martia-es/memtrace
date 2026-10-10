import type { ExportKind } from "@/domain/data-export";
import type { TenantScope } from "@/domain/tenant";

/** Lectura masiva de los datos de un experimento para exportarlos (ADR-084). */
export interface DataExporter {
  count(scope: TenantScope, kind: ExportKind, from: Date, to: Date): Promise<number>;
  /** Una línea JSON por fila, sin el salto de línea final. */
  stream(scope: TenantScope, kind: ExportKind, from: Date, to: Date): AsyncIterable<string>;
}
