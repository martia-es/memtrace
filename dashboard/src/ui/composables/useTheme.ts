import { ref, watch } from "vue";
import { Dark } from "quasar";

const STORAGE_KEY = "memtrace.theme";

export type Theme = "light" | "dark";

function load(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Shared across the app and persisted: the user picks it once from UserMenu. */
const theme = ref<Theme>(load());

watch(
  theme,
  (value) => {
    Dark.set(value === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable: only persistence is lost */
    }
  },
  { immediate: true },
);

export function useTheme() {
  const toggle = () => {
    theme.value = theme.value === "dark" ? "light" : "dark";
  };
  return { theme, toggle };
}
