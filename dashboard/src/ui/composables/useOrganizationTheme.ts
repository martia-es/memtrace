import type { OrganizationThemeDto } from "@/application/identity-api";

type RadiusPreset = NonNullable<OrganizationThemeDto["radiusPreset"]>;

/** Presets coherentes entre los 3 tokens de radius (ADR-018/ADR-019). "sharp" = default actual de app.css. */
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
  return luminance > 0.5 ? "#0e1a13" : "#ffffff";
}

/**
 * Sobrescribe los tokens --mt-accent/--mt-accent-ink/--mt-radius-* en :root con el tema de la
 * organización actual (ADR-019). `null` en un campo hace `removeProperty`, es decir, vuelve al
 * default de app.css — así queda por encima de ambos temas claro/oscuro sin duplicar lógica (ADR-017).
 */
export function applyOrganizationTheme(theme: OrganizationThemeDto | null): void {
  const root = document.documentElement.style;

  if (theme?.accentColor) {
    root.setProperty("--mt-accent", theme.accentColor);
    root.setProperty("--mt-accent-ink", contrastInk(theme.accentColor));
  } else {
    root.removeProperty("--mt-accent");
    root.removeProperty("--mt-accent-ink");
  }

  const preset = theme?.radiusPreset ? RADIUS_PRESETS[theme.radiusPreset] : null;
  if (preset) {
    root.setProperty("--mt-radius-xs", preset.xs);
    root.setProperty("--mt-radius-sm", preset.sm);
    root.setProperty("--mt-radius-lg", preset.lg);
  } else {
    root.removeProperty("--mt-radius-xs");
    root.removeProperty("--mt-radius-sm");
    root.removeProperty("--mt-radius-lg");
  }
}
