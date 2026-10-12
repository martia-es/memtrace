import { describe, expect, it } from "vitest";
import { costOf, toPricingCatalog, type ModelPricing } from "@/domain/pricing";

const row = (modelId: string, input: number, output: number): ModelPricing => ({ modelId, provider: "x", inputPricePerToken: input, outputPricePerToken: output, source: "litellm", updatedAtMs: 0 });

const catalog = toPricingCatalog([
  row("gpt-5.2", 1, 2),
  row("azure/gpt-5.2", 9, 9),
  row("claude-3-5-sonnet-20241022", 3, 15),
  row("gpt-5-mini", 0.1, 0.2),
]);

describe("costOf", () => {
  it("usa el nombre exacto cuando existe", () => {
    expect(costOf("gpt-5.2", 10, 10, catalog)).toBe(30);
  });

  it("ignora el sufijo de fecha de la traza", () => {
    expect(costOf("gpt-5.2-2025-12-11", 10, 10, catalog)).toBe(30);
  });

  it("encuentra un precio con fecha cuando la traza no la trae", () => {
    expect(costOf("claude-3-5-sonnet", 1, 1, catalog)).toBe(18);
  });

  it("ignora el prefijo de proveedor y prefiere la fila sin prefijo", () => {
    expect(costOf("openai/gpt-5.2-2025-12-11", 10, 10, catalog)).toBe(30);
  });

  it("no quita sufijos que cambian el modelo (mini, high)", () => {
    expect(costOf("gpt-5-nano-2025-08-07", 1, 1, catalog)).toBeNull();
    expect(costOf("gpt-5.2-high", 1, 1, catalog)).toBeNull();
  });

  it("devuelve null sin modelo o sin precio", () => {
    expect(costOf(null, 1, 1, catalog)).toBeNull();
    expect(costOf("desconocido", 1, 1, catalog)).toBeNull();
  });
});
