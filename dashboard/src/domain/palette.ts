// Paleta de colores centralizada para toda la aplicación
export const PALETTE = {
  // Verdes primarios
  lightGreen: "#e8f9d6",  // Verde claro (fondos suaves)
  mediumGreen: "#7ecf96", // Verde medio
  darkGreen: "#4a7c59",   // Verde oscuro (énfasis)
  teal: "#5fb59a",        // Teal (azul verdoso)
  olive: "#8b9b3f",       // Oliva
  seafoam: "#6ab89a",     // Espuma de mar
  sage: "#7a9b6f",        // Salvia
  moss: "#6b8e3d",        // Musgo
} as const;

export const SPAN_COLORS = {
  agent: PALETTE.darkGreen,
  llm: PALETTE.mediumGreen,
  tool: PALETTE.teal,
  chain: PALETTE.olive,
  retriever: PALETTE.sage,
  embedding: PALETTE.seafoam,
  unknown: PALETTE.moss,
} as const;

export const SPAN_BG_COLORS = {
  agent: PALETTE.lightGreen,
  llm: "#dff5e8",
  tool: "#dff5e8",
  chain: PALETTE.lightGreen,
  retriever: PALETTE.lightGreen,
  embedding: "#dff5e8",
  unknown: PALETTE.lightGreen,
} as const;

export const CHART_COLORS = [
  PALETTE.darkGreen,
  PALETTE.mediumGreen,
  PALETTE.teal,
  PALETTE.teal,
  PALETTE.sage,
  PALETTE.seafoam,
  PALETTE.moss,
  PALETTE.darkGreen,
] as const;

export const ERROR_COLOR = PALETTE.darkGreen;
export const OK_COLOR = PALETTE.mediumGreen;
export const WARN_COLOR = "#fce4a3";
