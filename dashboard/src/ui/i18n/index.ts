import { ref, watch } from "vue";
import { Lang } from "quasar";
import quasarEn from "quasar/lang/en-US";
import quasarEs from "quasar/lang/es";
import { setLocaleProvider, setTranslator } from "@/domain/translate";
import en from "./en";
import es from "./es";

export type Params = Record<string, string | number | boolean | null | undefined>;
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

// importados de forma estática: un import() dinámico del idioma por defecto de Quasar crea un ciclo de chunks en la build
const QUASAR_PACKS: Record<Locale, unknown> = { en: quasarEn, es: quasarEs };

watch(
  locale,
  (value) => {
    document.documentElement.lang = value;
    Lang.set(QUASAR_PACKS[value] as Parameters<typeof Lang.set>[0]);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable: only persistence is lost */
    }
  },
  { immediate: true },
);

/** Translates `key` into the active locale, replacing `{name}` placeholders. Falls back to English, then to the key. */
export function t(key: MessageKey, params?: Params): string {
  const message = CATALOGS[locale.value][key] ?? en[key] ?? key;
  return params ? message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name] ?? "") : whole)) : message;
}

// el dominio traduce a través de este puerto (domain/translate.ts)
setTranslator((key, params) => t(key as MessageKey, params));

setLocaleProvider(() => (locale.value === "es" ? "es-ES" : "en-US"));

/** Plural pair: the catalog holds `<key>.one` and `<key>.other`; `{count}` is filled in automatically. */
export function tp(key: string, count: number, params?: Params): string {
  const rule = new Intl.PluralRules(locale.value).select(count) === "one" ? "one" : "other";
  return t(`${key}.${rule}` as MessageKey, { count, ...params });
}

/** Título de una ruta (su `meta.title` está en inglés): la versión traducida si hay clave, o el propio texto. */
export function routeTitle(title: unknown): string {
  const key = `routeTitle.${String(title)}`;
  return typeof title === "string" && key in en ? t(key as MessageKey) : String(title ?? "MemTrace");
}

/** Locale for `Intl`/`toLocale*` calls: the English variant a screen already used, or es-ES when Spanish is active. */
export const dateLocale = (english = "en-US"): string => (locale.value === "es" ? "es-ES" : english);

export function useI18n() {
  return { t, tp, locale, locales: LOCALES, setLocale: (value: Locale) => (locale.value = value) };
}
