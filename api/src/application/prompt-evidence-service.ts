import type { PromptEvidenceRepository } from "@/application/ports/prompt-evidence-repository";
import { buildPromptEvidence, type PromptEvidence } from "@/domain/prompt-evidence";
import type { PricingCatalog } from "@/domain/pricing";
import { resolveTimeRange } from "@/domain/time-range";

/**
 * Evidencia por versión de un prompt (ADR-069): coste, latencia, errores por causa, feedback y scores de las trazas que
 * usaron cada versión. La ruta ya comprobó que el prompt pertenece al agente y que quien pregunta puede leer sus datos.
 */
export class PromptEvidenceService {
  constructor(
    private readonly repository: PromptEvidenceRepository,
    /** catálogo de precios vigente (ADR-025); el repositorio de evidencia no conoce precios */
    private readonly pricing: () => Promise<PricingCatalog>,
    private readonly now: () => number = Date.now,
  ) {}

  async forPrompt(promptName: string, serviceName: string, input: { from?: Date; to?: Date }): Promise<PromptEvidence> {
    const range = resolveTimeRange(input, this.now());
    const [rows, pricing] = await Promise.all([this.repository.rowsFor({ ...range, service: serviceName, promptName }), this.pricing()]);
    return buildPromptEvidence(rows, pricing, range);
  }
}
