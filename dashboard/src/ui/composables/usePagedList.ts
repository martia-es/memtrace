import { onBeforeUnmount, ref, type Ref } from "vue";
import type { MergedList, Paged } from "@/domain/merge";
import { useAsync } from "./useAsync";

export interface PagedListOptions<T> {
  key: (item: T) => string;
  /** pide una página; `cursor` undefined = la primera */
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<Paged<T>>;
  /** integra una actualización automática con lo ya cargado */
  merge: (current: T[], cursor: string | null, latest: Paged<T>) => MergedList<T>;
  /** se llama tras cada carga correcta de la primera página */
  onLoaded?: () => void;
}

/**
 * Listado paginado por cursor con actualización en vivo:
 *  - `reload()` (filtros, botón) reemplaza la lista;
 *  - `refresh()` (automático) la fusiona, sin perder lo cargado con `loadMore()`, y marca lo nuevo unos segundos.
 */
export function usePagedList<T>(options: PagedListOptions<T>) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const nextCursor = ref<string | null>(null);
  const newKeys = ref<Set<string>>(new Set());
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const first = useAsync((signal) => options.load(undefined, signal));
  const more = useAsync((signal) => options.load(nextCursor.value ?? undefined, signal));

  function flash(keys: string[]) {
    if (keys.length === 0) return;
    newKeys.value = new Set(keys);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (newKeys.value = new Set()), 3000);
  }
  onBeforeUnmount(() => flashTimer && clearTimeout(flashTimer));

  async function run(live: boolean) {
    const page = await first.run();
    if (!page) return false;
    if (live) {
      const merged = options.merge(items.value, nextCursor.value, page);
      items.value = merged.items;
      nextCursor.value = merged.nextCursor;
      flash(merged.newKeys);
    } else {
      items.value = page.items;
      nextCursor.value = page.nextCursor;
    }
    options.onLoaded?.();
    return true;
  }

  async function loadMore() {
    const page = await more.run();
    if (!page) return;
    const known = new Set(items.value.map(options.key));
    items.value = [...items.value, ...page.items.filter((t) => !known.has(options.key(t)))];
    nextCursor.value = page.nextCursor;
  }

  return {
    items,
    nextCursor,
    newKeys,
    loading: first.loading,
    error: first.error,
    moreLoading: more.loading,
    moreError: more.error,
    reload: () => run(false),
    refresh: () => run(true),
    loadMore,
  };
}
