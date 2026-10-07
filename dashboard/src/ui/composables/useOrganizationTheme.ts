import type { OrganizationThemeDto } from "@/application/identity-api";

type RadiusPreset = NonNullable<OrganizationThemeDto["radiusPreset"]>;
type FontPreset = NonNullable<OrganizationThemeDto["fontPreset"]>;

/** Pilas del sistema: sin cargar fuentes externas (CSP, rendimiento y privacidad). Sin preset queda Plus Jakarta Sans de app.css (ADR-063). */
const FONT_STACKS: Record<FontPreset, string> = {
  system: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  serif: `Georgia, "Iowan Old Style", "Times New Roman", serif`,
  humanist: `Optima, Candara, "Segoe UI", "Gill Sans", sans-serif`,
};

/** Presets coherentes entre los 3 tokens de radius (ADR-018/ADR-019). Sin preset se usa el 4/6/8 px de app.css (ADR-048). */
const RADIUS_PRESETS: Record<RadiusPreset, { xs: string; sm: string; lg: string }> = {
  sharp: { xs: "0px", sm: "0px", lg: "0px" },
  soft: { xs: "4px", sm: "8px", lg: "14px" },
  round: { xs: "8px", sm: "14px", lg: "24px" },
};

/** Blanco o negro según luminancia relativa del fondo (WCAG), para que el texto de acento siempre sea legible. */
function contrastInk(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.5 ? "#0a2321" : "#ffffff";
}

/**
 * Variables CSS que fija un tema (ADR-019, ADR-063). Solo incluye lo configurado: lo que falta cae en el
 * default de app.css. Se usa tanto en :root como en la vista previa del formulario de apariencia.
 */
export function themeCssVars(theme: OrganizationThemeDto | null): Record<string, string> {
  const vars: Record<string, string> = {};
  if (theme?.accentColor) {
    vars["--mt-accent"] = theme.accentColor;
    vars["--mt-accent-ink"] = contrastInk(theme.accentColor);
  }
  const radius = theme?.radiusPreset ? RADIUS_PRESETS[theme.radiusPreset] : null;
  if (radius) {
    vars["--mt-radius-xs"] = radius.xs;
    vars["--mt-radius-sm"] = radius.sm;
    vars["--mt-radius-lg"] = radius.lg;
  }
  if (theme?.secondaryColor) {
    vars["--mt-highlight"] = theme.secondaryColor;
    vars["--mt-highlight-soft"] = `color-mix(in srgb, ${theme.secondaryColor} 18%, var(--mt-card))`;
    vars["--mt-highlight-ink"] = `color-mix(in srgb, ${theme.secondaryColor} 60%, var(--mt-ink))`;
  }
  if (theme?.fontPreset) vars["--mt-sans"] = FONT_STACKS[theme.fontPreset];
  return vars;
}

const THEME_VARS = [
  "--mt-accent", "--mt-accent-ink", "--mt-radius-xs", "--mt-radius-sm", "--mt-radius-lg",
  "--mt-highlight", "--mt-highlight-soft", "--mt-highlight-ink", "--mt-sans",
] as const;

/**
 * Sobrescribe los tokens del tema en :root con el de la organización actual. Lo que el tema no fija
 * hace `removeProperty`, es decir, vuelve al default de app.css — así queda por encima de ambos temas
 * claro/oscuro sin duplicar lógica (ADR-017).
 */
export function applyOrganizationTheme(theme: OrganizationThemeDto | null): void {
  const root = document.documentElement.style;
  const vars = themeCssVars(theme);
  for (const name of THEME_VARS) {
    const value = vars[name];
    if (value) root.setProperty(name, value);
    else root.removeProperty(name);
  }
}
