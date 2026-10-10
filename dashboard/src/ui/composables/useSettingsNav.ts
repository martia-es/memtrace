import { ref } from "vue";

/**
 * Menú contextual de Settings: la página de organización registra aquí sus secciones y MainLayout
 * sustituye el menú principal por ellas mientras estén registradas (un solo menú lateral, sin pestañas
 * dentro de la página). Estado de módulo porque solo hay un sidebar por app, igual que `useTopbar`.
 */
export interface SettingsSection {
  id: string;
  label: string;
  /** path de un icono de 24x24 */
  icon: string;
  group: "Workspace" | "Governance" | "Organization";
  count?: number;
}
export interface SettingsNav {
  title: string;
  sections: readonly SettingsSection[];
}

const settingsNav = ref<SettingsNav | null>(null);

export function useSettingsNav() {
  return { settingsNav };
}

/** Conserva el orden; la cabecera de grupo solo acompaña a la primera sección de cada grupo. */
export function withGroupHeaders(sections: readonly SettingsSection[]): { section: SettingsSection; header: string | null }[] {
  return sections.map((section, i) => ({ section, header: sections[i - 1]?.group === section.group ? null : section.group }));
}
