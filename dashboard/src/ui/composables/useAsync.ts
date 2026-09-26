import { onScopeDispose, ref, shallowRef } from "vue";

/**
 * Carga asíncrona con cancelación: si se lanza otra carga, la anterior se aborta y su resultado se ignora
 * (evita que una respuesta lenta pise a una más reciente).
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const data = shallowRef<T | null>(null);
  const error = shallowRef<Error | null>(null);
  const loading = ref(false);
  let controller: AbortController | null = null;

  async function run(): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader(current.signal);
      if (controller === current) data.value = result;
    } catch (e) {
      if (current.signal.aborted) return;
      if (controller === current) error.value = e instanceof Error ? e : new Error(String(e));
    } finally {
      if (controller === current) loading.value = false;
    }
  }

  onScopeDispose(() => controller?.abort());
  return { data, error, loading, run };
}
