/** Conversión entre el formulario de score configs (ADR-036) y el DTO. Pura, sin Vue. */
import type { ScoreConfigDto } from "@contract";

export type ScoreConfigCategory = NonNullable<ScoreConfigDto["categories"]>[number];

/** Una categoría por línea: `label` o `label=valor` (valor numérico opcional, para categorías ordinales). Líneas en blanco se ignoran. */
export function parseCategories(text: string): ScoreConfigCategory[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const at = line.lastIndexOf("=");
      if (at < 0) return { label: line, value: null };
      const raw = line.slice(at + 1).trim();
      const value = raw === "" ? NaN : Number(raw);
      // `a=b` sin número tras el `=` se trata como etiqueta literal: no se inventa un valor.
      return Number.isFinite(value) ? { label: line.slice(0, at).trim(), value } : { label: line, value: null };
    });
}

export function formatCategories(categories: ScoreConfigCategory[] | null): string {
  return (categories ?? []).map((c) => (c.value === null ? c.label : `${c.label}=${c.value}`)).join("\n");
}

/** Resumen de una línea de lo que acepta la rúbrica, para la lista. */
export function describeScale(config: Pick<ScoreConfigDto, "dataType" | "minValue" | "maxValue" | "categories">): string {
  if (config.dataType === "numeric") return `${config.minValue} – ${config.maxValue}`;
  if (config.dataType === "boolean") return "true / false";
  return (config.categories ?? []).map((c) => c.label).join(" · ");
}

/** Valores enteros de una escala numérica corta (p. ej. 1–5), para pintar botones en vez de un campo libre. null si no encaja. */
export function numericChoices(config: Pick<ScoreConfigDto, "dataType" | "minValue" | "maxValue">): number[] | null {
  const { minValue: min, maxValue: max } = config;
  if (config.dataType !== "numeric" || min === null || max === null) return null;
  if (!Number.isInteger(min) || !Number.isInteger(max) || max - min > 9) return null;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Valores que puede elegir una persona para una config (botones o lista); null si hay que escribirlos (escala numérica ancha). */
export function valueChoices(config: Pick<ScoreConfigDto, "dataType" | "minValue" | "maxValue" | "categories">): Array<{ value: string; label: string }> | null {
  if (config.dataType === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (config.dataType === "categorical") return (config.categories ?? []).map((c) => ({ value: c.label, label: c.label }));
  return numericChoices(config)?.map((n) => ({ value: String(n), label: String(n) })) ?? null;
}
