/** Catálogo de precios por modelo, sincronizado desde LiteLLM a `memtrace.model_pricing` (ADR-025). */
export interface ModelPricing {
  modelId: string;
  provider: string;
  inputPricePerToken: number;
  outputPricePerToken: number;
  source: string;
  updatedAtMs: number;
}

export type PricingCatalog = ReadonlyMap<string, ModelPricing>;

export function toPricingCatalog(rows: ModelPricing[]): PricingCatalog {
  return new Map(rows.map((r) => [r.modelId, r]));
}

/** null si no hay modelo, o no hay precio conocido para él en el catálogo (ver ADR-025: limitación de nombres). */
export function costOf(model: string | null, inputTokens: number, outputTokens: number, pricing: PricingCatalog): number | null {
  if (!model) return null;
  const price = pricing.get(model);
  if (!price) return null;
  return inputTokens * price.inputPricePerToken + outputTokens * price.outputPricePerToken;
}
