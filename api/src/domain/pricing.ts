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

import { candidateBase, modelKey, squash } from "./model-quality";

export function toPricingCatalog(rows: ModelPricing[]): PricingCatalog {
  return new Map(rows.map((r) => [r.modelId, r]));
}

/** Clave de un nombre para buscar precio: sin prefijo de proveedor ni fecha, la misma normalización que usa Quality (ADR-025). */
const priceKey = (name: string): string => squash(candidateBase(modelKey(name), true).base);

const keyIndexes = new WeakMap<PricingCatalog, Map<string, ModelPricing>>();

/** Índice por `priceKey`, calculado una vez por catálogo. Ante varias filas con la misma clave gana la que no lleva fecha ni prefijo. */
function keyIndex(pricing: PricingCatalog): Map<string, ModelPricing> {
  let index = keyIndexes.get(pricing);
  if (index) return index;
  index = new Map();
  const plain = new Set<string>();
  for (const [id, row] of pricing) {
    const k = priceKey(id);
    const isPlain = squash(modelKey(id)) === k && !id.includes("/");
    if (!index.has(k) || (isPlain && !plain.has(k))) index.set(k, row);
    if (isPlain) plain.add(k);
  }
  keyIndexes.set(pricing, index);
  return index;
}

/** null si no hay modelo o no hay precio: primero por nombre exacto, luego ignorando prefijo de proveedor y fecha. */
export function costOf(model: string | null, inputTokens: number, outputTokens: number, pricing: PricingCatalog): number | null {
  if (!model) return null;
  const price = pricing.get(model) ?? keyIndex(pricing).get(priceKey(model));
  if (!price) return null;
  return inputTokens * price.inputPricePerToken + outputTokens * price.outputPricePerToken;
}
