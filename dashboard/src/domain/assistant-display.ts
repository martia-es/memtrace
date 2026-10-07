/** Formas de ver el asistente y su resolución entre organización y usuario (ADR-063). Reglas puras. */

export type AssistantDisplayMode = "bubble" | "dock" | "fullscreen";

export const ASSISTANT_DISPLAY_MODES: readonly AssistantDisplayMode[] = ["bubble", "dock", "fullscreen"];

export const MODE_LABELS: Record<AssistantDisplayMode, string> = {
  bubble: "Bubble",
  dock: "Side panel",
  fullscreen: "Full screen",
};

/** Lo que de verdad lee de un tema el resolutor: así no depende del DTO completo. */
export interface AssistantDisplayTheme {
  assistantName: string | null;
  assistantDefaultMode: AssistantDisplayMode | null;
  assistantAllowedModes: readonly AssistantDisplayMode[] | null;
}

/** Modos que la organización permite; sin configurar (o lista vacía) son todos. */
export function allowedModes(theme: Pick<AssistantDisplayTheme, "assistantAllowedModes"> | null): readonly AssistantDisplayMode[] {
  const allowed = theme?.assistantAllowedModes;
  return allowed && allowed.length > 0 ? ASSISTANT_DISPLAY_MODES.filter((m) => allowed.includes(m)) : ASSISTANT_DISPLAY_MODES;
}

/**
 * Modo efectivo: la preferencia personal si la organización la permite; si no, el defecto de la
 * organización si está permitido; si no, la burbuja o el primer modo permitido.
 */
export function resolveMode(theme: AssistantDisplayTheme | null, userMode: AssistantDisplayMode | null): AssistantDisplayMode {
  const allowed = allowedModes(theme);
  if (userMode && allowed.includes(userMode)) return userMode;
  const orgDefault = theme?.assistantDefaultMode;
  if (orgDefault && allowed.includes(orgDefault)) return orgDefault;
  return allowed.includes("bubble") ? "bubble" : allowed[0]!;
}

/** Nombre que ve la persona en el chat: el configurado por la organización o el del agente. */
export function assistantDisplayName(theme: Pick<AssistantDisplayTheme, "assistantName"> | null, agentName: string): string {
  const name = theme?.assistantName?.trim();
  return name ? name : agentName;
}

export function isDisplayMode(value: unknown): value is AssistantDisplayMode {
  return ASSISTANT_DISPLAY_MODES.includes(value as AssistantDisplayMode);
}

/** Parámetros de la pestaña de pantalla completa; el agente y el entorno viajan para pintar la cabecera sin otra llamada. */
export interface FullscreenTarget {
  experimentId: string;
  deploymentId: string;
  agentName: string;
  environmentLabel: string;
}

export function fullscreenPath(target: FullscreenTarget): string {
  const query = new URLSearchParams({
    experimentId: target.experimentId,
    deploymentId: target.deploymentId,
    agent: target.agentName,
    env: target.environmentLabel,
  });
  return `/assistant?${query.toString()}`;
}

export function parseFullscreenQuery(query: Record<string, unknown>): FullscreenTarget | null {
  const pick = (key: string) => (typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : null);
  const experimentId = pick("experimentId");
  const deploymentId = pick("deploymentId");
  const agentName = pick("agent");
  const environmentLabel = pick("env");
  return experimentId && deploymentId && agentName && environmentLabel ? { experimentId, deploymentId, agentName, environmentLabel } : null;
}
