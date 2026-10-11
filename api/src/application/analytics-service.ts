import type { AnalyticsRepository } from "@/application/ports/analytics-repository";
import { buildAnalytics, type Analytics, type AnalyticsGroup } from "@/domain/analytics";
import type { PricingCatalog } from "@/domain/pricing";
import type { TenantScope } from "@/domain/tenant";
import { resolveTimeRange } from "@/domain/time-range";

/**
 * Overview › Analytics: las trazas del agente agrupadas por versión de prompt o por entorno, con coste, errores con su margen,
 * latencia y tendencia. La ruta ya comprobó que se puede leer el agente.
 */
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    /** catálogo de precios vigente (ADR-025); el repositorio no conoce precios */
    private readonly pricing: () => Promise<PricingCatalog>,
    private readonly now: () => number = Date.now,
  ) {}

  async breakdown(scope: TenantScope, input: { groupBy: AnalyticsGroup; from?: Date; to?: Date }): Promise<Analytics> {
    const range = resolveTimeRange(input, this.now());
    const [rows, pricing] = await Promise.all([this.repository.rowsFor({ ...range, scope, groupBy: input.groupBy }), this.pricing()]);
    return buildAnalytics(input.groupBy, rows, pricing, range);
  }
}
