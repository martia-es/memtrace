export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  primary: string;
  danger: string;
  accent: string;
}

export function chartColors(dark: boolean): ChartColors {
  return dark
    ? { text: "#e3e8f0", muted: "#9aa6b8", grid: "rgba(255,255,255,0.10)", primary: "#7c9cff", danger: "#ff6b6b", accent: "#f0b34a" }
    : { text: "#1f2a3a", muted: "#5b6779", grid: "rgba(0,0,0,0.08)", primary: "#3b5bdb", danger: "#e03131", accent: "#d9822b" };
}
