import type { AlertRule, Sample } from "@/domain/alert";
import type { TenantScope } from "@/domain/tenant";

/** Mide una regla sobre una ventana de tiempo (ADR-086). Lo implementa quien sabe leer trazas, votos y gráficas guardadas. */
export interface AlertMetricSource {
  /** El valor de la regla en la unidad de su umbral y con cuántas observaciones se calculó. */
  measure(rule: AlertRule, scope: TenantScope, now: Date): Promise<Sample>;
  /** Coste estimado entre dos instantes (para el gasto diario de los presupuestos). */
  cost(scope: TenantScope, from: Date, to: Date): Promise<number>;
  /** Olvida lo medido: se llama al empezar cada pasada. */
  reset(): void;
}
