export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  primary: string;
  danger: string;
  /** Semantic good / caution colors for pass-fail charts. */
  ok: string;
  warn: string;
  accent: string;
  /** Monochrome scale for categorical series (pie slices, multi-series charts), darkest/lightest first. */
  series: readonly string[];
}

// Series categóricas del diseño Mediterráneo (ADR-048): turquesa, terracota, mar hondo, sol, arena y pizarra.
const SERIES_LIGHT = ["#00b3ad", "#ff6b4a", "#0a5c8f", "#ffb820", "#c9a27a", "#64748b"] as const;
const SERIES_DARK = ["#2bc4bd", "#ff8a6b", "#4c9bd6", "#ffc24d", "#d6b48c", "#8497b0"] as const;

export function chartColors(dark: boolean): ChartColors {
  return dark
    ? { text: "#e6f4f2", muted: "#8fb0ac", grid: "rgba(255,255,255,0.10)", primary: "#2bc4bd", danger: "#ff6b88", ok: "#4ade80", warn: "#fbbf24", accent: "#ff8a6b", series: SERIES_DARK }
    : { text: "#0a2321", muted: "#4d6a67", grid: "rgba(10,35,33,0.08)", primary: "#00b3ad", danger: "#e11d48", ok: "#16a34a", warn: "#f59e0b", accent: "#ff6b4a", series: SERIES_LIGHT };
}
