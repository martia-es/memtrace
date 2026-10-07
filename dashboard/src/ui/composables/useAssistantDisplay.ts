import { computed, reactive, ref } from "vue";
import type { OrganizationThemeDto } from "@/application/identity-api";
import { assistantDisplayName, isDisplayMode, resolveMode, type AssistantDisplayMode } from "@/domain/assistant-display";

/**
 * Cómo ve la persona al asistente (ADR-063): modo permitido por la organización + preferencia personal.
 * Es de módulo y síncrono a propósito: `useChatDock().open` necesita decidir en el gesto del clic
 * (si no, el navegador bloquea la pestaña de pantalla completa).
 */
const USER_MODE_KEY = "memtrace:assistantMode";

function readUserMode(): AssistantDisplayMode | null {
  try {
    const stored = localStorage.getItem(USER_MODE_KEY);
    return isDisplayMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

const userMode = ref<AssistantDisplayMode | null>(readUserMode());
/** temas de organización por experimento, los rellena MainLayout con la lista de experimentos que ya carga */
const themes = reactive<Record<string, OrganizationThemeDto>>({});

export function setKnownThemes(experiments: Array<{ id: string; organizationTheme: OrganizationThemeDto }>): void {
  for (const e of experiments) themes[e.id] = e.organizationTheme;
}

export function setUserMode(mode: AssistantDisplayMode): void {
  userMode.value = mode;
  try {
    localStorage.setItem(USER_MODE_KEY, mode);
  } catch {
    // sin almacenamiento la preferencia dura lo que dure la pestaña
  }
}

export function themeFor(experimentId: string): OrganizationThemeDto | null {
  return themes[experimentId] ?? null;
}

export function modeFor(experimentId: string): AssistantDisplayMode {
  return resolveMode(themeFor(experimentId), userMode.value);
}

export function useAssistantDisplay(experimentId: () => string | null) {
  const theme = computed(() => (experimentId() ? themeFor(experimentId()!) : null));
  return {
    theme,
    mode: computed(() => resolveMode(theme.value, userMode.value)),
    nameFor: (agentName: string) => assistantDisplayName(theme.value, agentName),
  };
}
