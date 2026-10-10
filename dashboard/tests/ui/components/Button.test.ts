import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Button from "@/ui/components/Button.vue";

describe("Button", () => {
  it("renders a type=button secondary md button by default and forwards attributes", async () => {
    const w = mount(Button, { slots: { default: "Save" }, attrs: { "data-testid": "save", "aria-label": "Save it" } });
    const b = w.get("button");
    expect(b.attributes("type")).toBe("button");
    expect(b.classes()).toEqual(expect.arrayContaining(["mt-btn", "v-secondary", "s-md"]));
    expect(b.attributes("data-testid")).toBe("save");
    expect(b.text()).toBe("Save");
    await b.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });

  it.each(["primary", "secondary", "danger", "link", "icon"] as const)("applies the %s variant", (variant) => {
    expect(mount(Button, { props: { variant } }).get("button").classes()).toContain(`v-${variant}`);
  });

  it("does not emit clicks while disabled or loading, and flags loading as busy", async () => {
    const off = mount(Button, { props: { disabled: true } });
    await off.get("button").trigger("click");
    expect(off.emitted("click")).toBeUndefined();

    const busy = mount(Button, { props: { loading: true } });
    expect(busy.get("button").attributes("disabled")).toBeDefined();
    expect(busy.get("button").attributes("aria-busy")).toBe("true");
    expect(busy.find(".spin").exists()).toBe(true);
  });
});

/** Guardia: el dashboard usa solo `Button`; nada de q-btn ni de clases de botón locales. */
describe("button usage across the dashboard", () => {
  const UI = join(__dirname, "..", "..", "..", "src", "ui");
  const vueFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith(".vue") ? [p] : [];
    });
  const OLD = /class="[^"]*\b(primary-btn|ghost-btn|small-btn|adm-btn|link-btn|icon-btn|page-btn|danger-btn|outline-btn)\b/;

  it("has no <q-btn> and no legacy button classes", () => {
    const offenders = vueFiles(UI).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /<q-btn[\s>]/.test(src) || OLD.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
