import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TextInput from "@/ui/components/TextInput.vue";

describe("TextInput", () => {
  it("emits the typed text, and a number for type=number", async () => {
    const text = mount(TextInput, { props: { modelValue: "" } });
    await text.get("input").setValue("hola");
    expect(text.emitted("update:modelValue")![0]).toEqual(["hola"]);

    const num = mount(TextInput, { props: { modelValue: 1, type: "number" } });
    await num.get("input").setValue("42");
    expect(num.emitted("update:modelValue")![0]).toEqual([42]);
  });

  it("renders a textarea when multiline and forwards attributes to the control", () => {
    const w = mount(TextInput, { props: { modelValue: "x", multiline: true }, attrs: { "data-testid": "area", class: "wide" } });
    expect(w.get("textarea").attributes("data-testid")).toBe("area");
    expect(w.classes()).toContain("wide");
  });

  it("clears a search and flags invalid state", async () => {
    const w = mount(TextInput, { props: { modelValue: "abc", type: "search", invalid: true } });
    expect(w.get("input").attributes("aria-invalid")).toBe("true");
    await w.get(".ti-clear").trigger("click");
    expect(w.emitted("update:modelValue")![0]).toEqual([""]);
  });
});
