import type { BreakdownRepository } from "@/application/ports/breakdown-repository";
import { buildBreakdown, type Breakdown, type BreakdownGroup } from "@/domain/breakdown";
import type { PricingCatalog } from "@/domain/pricing";
import type { TenantScope } from "@/domain/tenant";
import { resolveTimeRange } from "@/domain/time-range";

/**
 * Overview › Breakdown: las trazas del agente agrupadas por versión de prompt o por entorno, con coste, errores con su margen,
 * latencia y tendencia. La ruta ya comprobó que se puede leer el agente.
 */
export class BreakdownService {
  constructor(
    private readonly repository: BreakdownRepository,
    /** catálogo de precios vigente (ADR-025); el repositorio no conoce precios */
    private readonly pricing: () => Promise<PricingCatalog>,
    private readonly now: () => number = Date.now,
  ) {}

  async breakdown(scope: TenantScope, input: { groupBy: BreakdownGroup; from?: Date; to?: Date }): Promise<Breakdown> {
    const range = resolveTimeRange(input, this.now());
    const [rows, pricing] = await Promise.all([this.repository.rowsFor({ ...range, scope, groupBy: input.groupBy }), this.pricing()]);
    return buildBreakdown(input.groupBy, rows, pricing, range);
  }
}
