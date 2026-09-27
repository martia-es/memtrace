export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  primary: string;
  danger: string;
  accent: string;
  /** Monochrome scale for categorical series (pie slices, multi-series charts), darkest/lightest first. */
  series: readonly string[];
}

// Monochrome scale matching --mt-accent (ADR-018/monochrome UI): grayscale only, no hue.
const SERIES_LIGHT = ["#1c1f23", "#454950", "#6e727a", "#989ca4", "#c2c5cc"] as const;
const SERIES_DARK = ["#f2f3f5", "#c7cad0", "#9ca0a8", "#72767f", "#4a4e56"] as const;

export function chartColors(dark: boolean): ChartColors {
  return dark
    ? { text: "#e3e8f0", muted: "#9aa6b8", grid: "rgba(255,255,255,0.10)", primary: "#f2f3f5", danger: "#ff9d97", accent: "#f2f3f5", series: SERIES_DARK }
    : { text: "#1f2a3a", muted: "#5b6779", grid: "rgba(0,0,0,0.08)", primary: "#1c1f23", danger: "#b3261e", accent: "#1c1f23", series: SERIES_LIGHT };
}
