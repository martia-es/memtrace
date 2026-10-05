// Paleta de colores centralizada (ADR-048, diseño "Mediterráneo"): turquesa, terracota y complementarios.
export const PALETTE = {
  turquoise: "#00a6a0", // marca / LLM
  terracotta: "#f2603f", // acento cálido / herramientas
  deepSea: "#0a5c8f",
  sun: "#c9971f",
  slate: "#64748b",
  ink: "#4d6a67", // agentes (neutro)
  mist: "#8fa3a0", // desconocido
} as const;

export const SPAN_COLORS = {
  agent: PALETTE.ink,
  llm: PALETTE.turquoise,
  tool: PALETTE.terracotta,
  chain: PALETTE.deepSea,
  retriever: PALETTE.sun,
  embedding: PALETTE.slate,
  unknown: PALETTE.mist,
} as const;

// Fondo suave de las insignias de span: mezcla el color del kind con la tarjeta,
// así se adapta solo a tema claro/oscuro (--mt-card) sin duplicar una paleta oscura.
export function spanBg(color: string): string {
  return `color-mix(in srgb, ${color} 18%, var(--mt-card))`;
}

export const CHART_COLORS = [
  PALETTE.turquoise,
  PALETTE.terracotta,
  PALETTE.deepSea,
  PALETTE.sun,
  PALETTE.slate,
] as const;

export const ERROR_COLOR = "#e11d48";
export const OK_COLOR = "#16a34a";
export const WARN_COLOR = "#f59e0b";
