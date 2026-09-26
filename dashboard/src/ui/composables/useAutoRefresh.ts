import { onScopeDispose, ref, watch } from "vue";

/** Ejecuta `callback` cada `intervalMs` mientras `enabled` esté activo y la pestaña sea visible. */
export function useAutoRefresh(callback: () => void, intervalMs = 10_000) {
  const enabled = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  watch(enabled, (on) => {
    stop();
    if (on) timer = setInterval(() => document.visibilityState === "visible" && callback(), intervalMs);
  });
  onScopeDispose(stop);
  return { enabled };
}
