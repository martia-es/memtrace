import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Checkbox from "@/ui/components/Checkbox.vue";
import Radio from "@/ui/components/Radio.vue";
import Pill from "@/ui/components/Pill.vue";
import StatusChip from "@/ui/components/StatusChip.vue";

describe("Checkbox", () => {
  it("toggles a boolean v-model and forwards attributes to the input", async () => {
    const w = mount(Checkbox, { props: { modelValue: false }, attrs: { "data-testid": "c", "aria-label": "Enable" } });
    const input = w.get("input");
    expect(input.attributes("data-testid")).toBe("c");
    await input.setValue(true);
    expect(w.emitted("update:modelValue")![0]).toEqual([true]);
  });

  it("adds and removes its value from an array v-model", async () => {
    const w = mount(Checkbox, { props: { modelValue: ["a"], value: "b" } });
    await w.get("input").setValue(true);
    expect(w.emitted("update:modelValue")![0]).toEqual([["a", "b"]]);
    const on = mount(Checkbox, { props: { modelValue: ["a", "b"], value: "b" } });
    expect((on.get("input").element as HTMLInputElement).checked).toBe(true);
    await on.get("input").setValue(false);
    expect(on.emitted("update:modelValue")![0]).toEqual([["a"]]);
  });

  it("keeps the :checked + @change pattern working and wraps the slot in a label", async () => {
    let changes = 0;
    const w = mount(Checkbox, { attrs: { checked: true, onChange: () => changes++ }, slots: { default: "Only mine" } });
    expect(w.element.tagName).toBe("LABEL");
    expect(w.text()).toBe("Only mine");
    expect((w.get("input").element as HTMLInputElement).checked).toBe(true);
    await w.get("input").trigger("change");
    expect(changes).toBe(1);
  });

  it("renders only the control without a slot, and a switch variant", () => {
    expect(mount(Checkbox).element.tagName).toBe("INPUT");
    const sw = mount(Checkbox, { props: { variant: "switch" }, slots: { default: "Archived" } });
    expect(sw.find(".track").exists()).toBe(true);
  });
});

describe("Radio", () => {
  it("reflects the selected value and emits its own value", async () => {
    const w = mount(Radio, { props: { modelValue: "a", value: "b" }, slots: { default: "B" }, attrs: { name: "g" } });
    const input = w.get("input");
    expect((input.element as HTMLInputElement).checked).toBe(false);
    expect(input.attributes("name")).toBe("g");
    await input.setValue(true);
    expect(w.emitted("update:modelValue")![0]).toEqual(["b"]);
  });
});

describe("Pill", () => {
  it("is neutral by default and applies tone, outline and mono", () => {
    expect(mount(Pill, { slots: { default: "x" } }).classes()).toContain("t-neutral");
    const w = mount(Pill, { props: { tone: "ok", outline: true, mono: true }, slots: { default: "x" } });
    expect(w.classes()).toEqual(expect.arrayContaining(["mt-pill", "t-ok", "outline", "mono"]));
  });

  it("StatusChip is a Pill with a dot and the label", () => {
    const w = mount(StatusChip, { props: { tone: "error", label: "Failed" } });
    expect(w.classes()).toEqual(expect.arrayContaining(["t-error", "with-dot"]));
    expect(w.text()).toBe("Failed");
  });
});

/** Guardia: ningún template vuelve a dibujar a mano un checkbox, radio o pill. */
describe("form controls and pills across the dashboard", () => {
  const UI = join(__dirname, "..", "..", "..", "src", "ui");
  const vueFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith(".vue") ? [p] : [];
    });
  const OWN = new Set(["Checkbox.vue", "Radio.vue", "Pill.vue"]);
  const offenders = (re: RegExp) => vueFiles(UI).filter((f) => !OWN.has(f.split("/").pop()!) && re.test(readFileSync(f, "utf8")));

  it("has no raw checkbox/radio inputs", () => expect(offenders(/<input[^>]*type="(checkbox|radio)"/)).toEqual([]));
  it("has no legacy pill classes", () => expect(offenders(/class="[^"]*\b(mt-pill|adm-pill)\b/)).toEqual([]));
});
