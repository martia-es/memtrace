import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Disclosure from "@/ui/components/Disclosure.vue";
import LoadingState from "@/ui/components/LoadingState.vue";
import Menu from "@/ui/components/Menu.vue";
import SegmentedControl from "@/ui/components/SegmentedControl.vue";
import Spinner from "@/ui/components/Spinner.vue";
import TabPanel from "@/ui/components/TabPanel.vue";
import ToggleChip from "@/ui/components/ToggleChip.vue";

describe("SegmentedControl", () => {
  const options = [{ value: "a", label: "A", testid: "opt-a" }, { value: "b", label: "B", count: 3 }];

  it("selects one value and exposes aria-pressed", async () => {
    const w = mount(SegmentedControl, { props: { options, modelValue: "a" } });
    const [a, b] = w.findAll("button");
    expect(a!.attributes("aria-pressed")).toBe("true");
    expect(b!.attributes("aria-pressed")).toBe("false");
    expect(b!.text()).toContain("3");
    expect(w.find("[data-testid=opt-a]").exists()).toBe(true);
    await b!.trigger("click");
    expect(w.emitted("update:modelValue")![0]).toEqual(["b"]);
  });

  it("toggles values in multiple mode and announces tabs", async () => {
    const w = mount(SegmentedControl, { props: { options, modelValue: ["a"], multiple: true, tabs: true } });
    expect(w.attributes("role")).toBe("tablist");
    await w.findAll("button")[1]!.trigger("click");
    expect(w.emitted("update:modelValue")![0]).toEqual([["a", "b"]]);
    await w.findAll("button")[0]!.trigger("click");
    expect(w.emitted("update:modelValue")![1]).toEqual([[]]);
  });
});

describe("ToggleChip, Disclosure, Spinner, LoadingState", () => {
  it("ToggleChip reflects pressed and shows a count", async () => {
    const w = mount(ToggleChip, { props: { pressed: true, count: 4 }, slots: { default: "Tool" } });
    expect(w.attributes("aria-pressed")).toBe("true");
    expect(w.classes()).toContain("on");
    expect(w.text()).toContain("4");
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });

  it("Disclosure shows the body only when open and emits toggle from the head", async () => {
    const w = mount(Disclosure, { props: { open: false, toggleTestid: "t" }, slots: { head: "Release", default: "<p>body</p>" } });
    expect(w.find("p").exists()).toBe(false);
    await w.get("[data-testid=t]").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
    await w.setProps({ open: true });
    expect(w.find("p").exists()).toBe(true);
    expect(w.get("button").attributes("aria-expanded")).toBe("true");
  });

  it("Spinner and LoadingState render a status indicator", () => {
    expect(mount(Spinner, { props: { size: "sm" } }).attributes("role")).toBe("status");
    expect(mount(LoadingState, { props: { size: "md" } }).find(".mt-spinner").exists()).toBe(true);
  });
});

describe("TabPanel", () => {
  it("mounts lazily on first activation and then only hides", async () => {
    const w = mount(TabPanel, { props: { active: false }, slots: { default: "<p>x</p>" } });
    expect(w.find("p").exists()).toBe(false);
    await w.setProps({ active: true });
    expect(w.find("p").exists()).toBe(true);
    await w.setProps({ active: false });
    expect(w.find("p").exists()).toBe(true);
    expect((w.element as HTMLElement).style.display).toBe("none");
  });
});

describe("Menu", () => {
  const Host = defineComponent({
    components: { Menu },
    render() {
      return h("button", { class: "trigger" }, [h(Menu, { autoClose: true }, { default: () => h("div", { class: "item" }, "Item") })]);
    },
  });

  it("opens from its parent trigger, renders in the body and closes on click, outside click and Esc", async () => {
    const w = mount(Host, { attachTo: document.body });
    expect(document.body.querySelector(".mt-menu")).toBeNull();
    await w.get(".trigger").trigger("click");
    await nextTick();
    expect(document.body.querySelector(".mt-menu .item")).not.toBeNull();
    (document.body.querySelector(".mt-menu") as HTMLElement).click();
    await nextTick();
    expect(document.body.querySelector(".mt-menu")).toBeNull();

    await w.get(".trigger").trigger("click");
    await nextTick();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector(".mt-menu")).toBeNull();

    await w.get(".trigger").trigger("click");
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(document.body.querySelector(".mt-menu")).toBeNull();
    w.unmount();
  });
});

/**
 * Guardia: un <button> crudo solo se permite donde el propio botón ES el componente (internos de
 * Button, ToggleChip, MenuItem, Disclosure, TabBar, SegmentedControl, Select, TextInput) o donde la
 * pieza es una fila/disparador con su propio diseño (no un botón de acción). Cualquier botón de acción
 * nuevo debe usar <Button>.
 */
describe("raw <button> elements", () => {
  const UI = join(__dirname, "..", "..", "..", "src", "ui");
  const vueFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith(".vue") ? [p] : [];
    });
  const ALLOWED = new Set([
    // internos de los componentes de interacción
    "Button.vue", "ToggleChip.vue", "MenuItem.vue", "Disclosure.vue", "TabBar.vue", "SegmentedControl.vue", "Select.vue", "TextInput.vue", "Switch.vue",
    // disparadores de menú o de popover con aspecto propio
    "ExperimentSelect.vue", "FilterBar.vue", "FilterPill.vue", "LiveControl.vue", "UserMenu.vue",
    // filas y tarjetas pulsables (la fila entera es el botón)
    "ConversationTree.vue", "ErrorOverviewCard.vue", "SpanTree.vue", "TraceTimeline.vue", "OfflineTrendView.vue", "MetricsPage.vue",
    "CustomChartsPanel.vue", "PromptFixFromFailure.vue", "PromptFragmentPicker.vue", "PromptDetailPage.vue",
    // controles específicos: cabecera ordenable, respuestas con atajo de teclado, filtro quitable, selector de modo del chat, botones de proveedor OAuth, maqueta
    "ModelPricingPage.vue", "AnnotationQueueReviewPage.vue", "ConversationsPage.vue", "AssistantModeSwitch.vue", "AssistantChatDock.vue", "LoginPage.vue", "OrganizationAppearance.vue",
  ]);
  it("only appear in the allow-listed files", () => {
    const offenders = vueFiles(UI).filter((f) => !ALLOWED.has(f.split("/").pop()!) && /<button\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

/** Guardia: el dashboard no usa widgets visuales de Quasar; solo iconos, la estructura de página (q-layout/q-page) y plugins (Notify, Dark). */
describe("no Quasar visual widgets across the dashboard", () => {
  const UI = join(__dirname, "..", "..", "..", "src", "ui");
  const vueFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith(".vue") ? [p] : [];
    });
  it("has no q-* components other than icons and the page shell (q-layout, q-page-container, q-page)", () => {
    const re = /<q-(?!icon\b|layout\b|page-container\b|page\b)[a-z-]+/;
    expect(vueFiles(UI).filter((f) => re.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
