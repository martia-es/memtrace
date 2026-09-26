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

/** Compartido entre páginas y persistido: el usuario elige el intervalo una vez. */
const seconds = ref<RefreshSeconds>(load());

export function setRefreshSeconds(value: RefreshSeconds) {
  seconds.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* almacenamiento no disponible: solo se pierde la persistencia */
  }
}

export interface LiveRefreshOptions {
  /** false => no refrescar ahora (p. ej. el detalle solo lo necesita mientras la traza está incompleta) */
  active?: () => boolean;
  /** true => hay una petición en curso: se salta el tick para no apilar peticiones */
  isBusy?: () => boolean;
}

/**
 * Llama a `callback` cada `seconds` segundos. Se pausa con la pestaña oculta y, al volver a verla,
 * refresca de inmediato para no enseñar datos viejos.
 */
export function useLiveRefresh(callback: () => unknown, options: LiveRefreshOptions = {}) {
  const updatedAt = ref<number | null>(null);
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
  document.addEventListener("visibilitychange", onVisible);
  onScopeDispose(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisible);
  });

  return { seconds, updatedAt, touch: () => (updatedAt.value = Date.now()) };
}
