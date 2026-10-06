import { onScopeDispose, ref, watch } from "vue";
import { DEFAULT_REFRESH_SECONDS, isRefreshSeconds, type RefreshSeconds } from "@/domain/refresh";

const STORAGE_KEY = "memtrace.refresh";

function load(): RefreshSeconds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw === null ? NaN : Number(raw);
    return isRefreshSeconds(value) ? value : DEFAULT_REFRESH_SECONDS;
  } catch {
    return DEFAULT_REFRESH_SECONDS;
  }
}

/** Shared between pages and persisted: the user chooses the interval once. */
const seconds = ref<RefreshSeconds>(load());

/** Última carga correcta de cualquier página: lo pinta el "Updated …" del topbar. */
const updatedAt = ref<number | null>(null);
/** "Refresh now" del topbar: cada página con refresco en vivo se suscribe y recarga. */
const refreshSignal = ref(0);
export const requestRefresh = () => refreshSignal.value++;
export { updatedAt as liveUpdatedAt, seconds as liveSeconds };

export function setRefreshSeconds(value: RefreshSeconds) {
  seconds.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable: only persistence is lost */
  }
}

export interface LiveRefreshOptions {
  /** false => don't refresh now (e.g., details only need it while the trace is incomplete) */
  active?: () => boolean;
  /** true => hay una petición en curso: se salta el tick para no apilar peticiones */
  isBusy?: () => boolean;
}

/**
 * Llama a `callback` cada `seconds` segundos. Se pausa con la pestaña oculta y, al volver a verla,
 * refresca de inmediato para no enseñar datos viejos.
 */
export function useLiveRefresh(callback: () => unknown, options: LiveRefreshOptions = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (document.visibilityState !== "visible") return;
    if (options.active && !options.active()) return;
    if (options.isBusy?.()) return;
    void callback();
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const schedule = () => {
    stop();
    if (seconds.value > 0) timer = setInterval(tick, seconds.value * 1000);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && seconds.value > 0) tick();
  };

  watch(seconds, schedule, { immediate: true });
  watch(refreshSignal, () => void callback());
  document.addEventListener("visibilitychange", onVisible);
  onScopeDispose(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisible);
  });

  return { seconds, updatedAt, touch: () => (updatedAt.value = Date.now()) };
}
