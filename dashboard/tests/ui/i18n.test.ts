import { afterEach, describe, expect, it } from "vitest";
import en from "@/ui/i18n/en";
import es from "@/ui/i18n/es";
import { locale, t } from "@/ui/i18n";

afterEach(() => {
  locale.value = "en";
});

describe("i18n", () => {
  it("es defines exactly the keys of en", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same placeholders in both languages", () => {
    const placeholders = (m: string) => (m.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("translates, interpolates and follows the active locale", () => {
    expect(t("nav.runs")).toBe("Runs");
    locale.value = "es";
    expect(t("nav.runs")).toBe("Ejecuciones");
    expect(t("nav.pendingApprovals", { count: 3 })).toBe("3 esperando tu aprobación");
  });

  it("persists the choice and sets the document language", async () => {
    locale.value = "es";
    await Promise.resolve();
    expect(localStorage.getItem("memtrace.locale")).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });
});
