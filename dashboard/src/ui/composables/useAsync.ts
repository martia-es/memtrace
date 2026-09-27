import { onScopeDispose, ref, shallowRef } from "vue";

/**
 * Async loading with cancellation: if another load is launched, the previous one is aborted and its result is ignored
 * (prevents a slow response from overwriting a more recent one).
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const data = shallowRef<T | null>(null);
  const error = shallowRef<Error | null>(null);
  const loading = ref(false);
  let controller: AbortController | null = null;

  /** Returns the result, or null if it failed or was replaced by a more recent load. */
  async function run(): Promise<T | null> {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = true;
    error.value = null;
    try {
      const result = await loader(current.signal);
      if (controller !== current) return null;
      data.value = result;
      return result;
    } catch (e) {
      if (current.signal.aborted) return null;
      if (controller === current) error.value = e instanceof Error ? e : new Error(String(e));
      return null;
    } finally {
      if (controller === current) loading.value = false;
    }
  }

  onScopeDispose(() => controller?.abort());
  return { data, error, loading, run };
}
