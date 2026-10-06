import { ref } from "vue";

/**
 * Topbar global (MainLayout): las páginas no pintan su cabecera, la "teletransportan" a estos dos
 * huecos (izquierda: breadcrumb/título; derecha: filtros y acciones). Estado de módulo porque solo
 * hay un topbar por app.
 */
const leftEl = ref<HTMLElement | null>(null);
const rightEl = ref<HTMLElement | null>(null);
/** cuántas páginas han rellenado el hueco izquierdo; a 0, el layout pinta el título de la ruta */
const leftCount = ref(0);

export function useTopbar() {
  return { leftEl, rightEl, leftCount };
}
