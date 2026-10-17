import { ref, watch } from "vue";
import { Lang } from "quasar";
import en from "./en";
import es from "./es";

export type Locale = "en" | "es";
export type MessageKey = keyof typeof en;

const STORAGE_KEY = "memtrace.locale";
export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];
const CATALOGS: Record<Locale, Record<string, string>> = { en, es };

const isLocale = (value: unknown): value is Locale => value === "en" || value === "es";

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage unavailable: fall back to the browser language */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Shared across the app and persisted: the user picks it once from UserMenu (same pattern as useTheme). */
export const locale = ref<Locale>(detect());

const QUASAR_PACKS: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("quasar/lang/en-US"),
  es: () => import("quasar/lang/es"),
};

watch(
  locale,
  (value) => {
    document.documentElement.lang = value;
    void QUASAR_PACKS[value]().then((pack) => Lang.set(pack.default as Parameters<typeof Lang.set>[0]));
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable: only persistence is lost */
    }
  },
  { immediate: true },
);

/** Translates `key` into the active locale, replacing `{name}` placeholders. Falls back to English, then to the key. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message = CATALOGS[locale.value][key] ?? en[key] ?? key;
  return params ? message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : message;
}

export function useI18n() {
  return { t, locale, locales: LOCALES, setLocale: (value: Locale) => (locale.value = value) };
}
