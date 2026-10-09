import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { computed } from "vue";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import CustomChartsPanel from "@/ui/components/CustomChartsPanel.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { optionLabels } from "./select";
import type { AttributeKeyDto } from "@contract";

const key = (k: string, kind: AttributeKeyDto["kind"], over: Partial<AttributeKeyDto> = {}): AttributeKeyDto => ({
  key: k,
  count: 10,
  kind,
  distinct: 5,
  numeric: false,
  hiddenByDefault: kind === "id" || kind === "text" || kind === "technical",
  ...over,
});

/** Lo que clasifica el servidor (ADR-077, fase 2): categorías y medidas se ven; ids, textos libres y detalles técnicos se ocultan. */
class Api extends FakeTraceApi {
  async getStepKinds() {
    return { items: [{ stepType: "tool", count: 2 }, { stepType: "chain", count: 6 }] };
  }
  async getAttributeKeys() {
    return {
      items: [
        key("gen_ai.tool.name", "category", { distinct: 3 }),
        key("city", "category", { distinct: 8 }),
        key("order_total", "number", { distinct: 90, numeric: true }),
        key("customer_id", "id", { distinct: 200, numeric: true }),
        key("message", "text", { distinct: 40 }),
        key("memtrace.step_type", "technical", { distinct: 2 }),
      ],
    };
  }
}

const exp = (role: string): ExperimentDto => ({ id: "e1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const RANGE = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" };
const entry = (kind: "step" | "attribute", key: string, displayName: string | null) => ({ kind, key, displayName, visibility: "auto" as const, updatedAt: "2026-10-09T10:00:00.000Z" });

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function open(identity: FakeIdentityApi, role = "technical") {
  mounted = mount(CustomChartsPanel, {
    props: { experimentId: "e1", range: RANGE },
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }]],
      provide: { [TRACE_API as symbol]: new Api(), [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return mounted;
}
const chips = (w: VueWrapper) => w.findAll("button.chip").map((c) => c.text().replace(/\d+$/, "").trim());
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);
async function typeName(id: string, value: string) {
  const input = byId<HTMLInputElement>(id)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
  await flushPromises();
}

describe("custom charts with a name catalog (ADR-077)", () => {
  it("shows the edited name where the builder offers a step, and leaves the rest as before", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [entry("step", "chain", "Personal data filter")];
    const w = await open(identity);
    expect(chips(w)).toEqual(["Tool calls", "Personal data filter"]);
    const questions = w.findAll(".question-card").map((q) => q.text());
    expect(questions.some((q) => q.includes('How often does "Personal data filter" happen?'))).toBe(true);
  });

  it("falls back to the automatic names when the catalog cannot be read", async () => {
    const identity = new FakeIdentityApi();
    identity.listChartCatalog = async () => {
      throw new Error("down");
    };
    const w = await open(identity);
    expect(chips(w)).toEqual(["Tool calls", "Chain"]);
  });

  it("offers Rename things only to people who can manage the catalog", async () => {
    const technical = await open(new FakeIdentityApi(), "technical");
    expect(technical.find("[data-testid='open-catalog']").exists()).toBe(true);
    technical.unmount();
    const governance = await open(new FakeIdentityApi(), "governance");
    expect(governance.find("[data-testid='open-catalog']").exists()).toBe(false);
  });

  it("lists what the agent reports, with the automatic name as placeholder, and hides technical attributes until asked", async () => {
    const w = await open(new FakeIdentityApi());
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    expect(byId("catalog-editor")).not.toBeNull();
    expect(byId<HTMLInputElement>("catalog-input-step-chain")!.placeholder).toBe("Chain");
    expect(byId<HTMLInputElement>("catalog-input-step-tool")!.placeholder).toBe("Tool calls");
    expect(byId<HTMLInputElement>("catalog-input-attribute-gen_ai.tool.name")!.placeholder).toBe("Tool");
    expect(byId("catalog-row-attribute-city")).not.toBeNull();
    expect(byId("catalog-row-attribute-memtrace.step_type")).toBeNull();
    byId<HTMLInputElement>("catalog-technical")!.click();
    await flushPromises();
    expect(byId("catalog-row-attribute-memtrace.step_type")).not.toBeNull();
  });

  it("saves a name and the builder uses it right away; resetting goes back to the automatic one", async () => {
    const identity = new FakeIdentityApi();
    const w = await open(identity);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();

    await typeName("catalog-input-step-chain", "  Personal data filter ");
    expect(identity.catalogCalls.at(-1)).toEqual({ method: "save", args: ["e1", { kind: "step", key: "chain", displayName: "Personal data filter", visibility: undefined }] });
    expect(chips(w)).toContain("Personal data filter");
    expect(byId("catalog-reset-step-chain")).not.toBeNull();

    byId("catalog-reset-step-chain")!.click();
    await flushPromises();
    expect(identity.catalogCalls.at(-1)).toEqual({ method: "delete", args: ["e1", "step", "chain"] });
    expect(chips(w)).toContain("Chain");
    expect(byId("catalog-reset-step-chain")).toBeNull();
  });

  it("clearing the name goes back to automatic without calling it a rename", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [entry("attribute", "city", "Town")];
    const w = await open(identity);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    expect(byId<HTMLInputElement>("catalog-input-attribute-city")!.value).toBe("Town");
    await typeName("catalog-input-attribute-city", "");
    expect(identity.catalogCalls.at(-1)).toEqual({ method: "save", args: ["e1", { kind: "attribute", key: "city", displayName: null, visibility: "auto" }] });
    expect(identity.chartCatalog).toEqual([]);
  });

  it("shows the reason when a name is refused and keeps what was written", async () => {
    const identity = new FakeIdentityApi();
    identity.catalogError = Object.assign(new Error("That name is already used"), { fields: { displayName: '"Tools" already names another step' } });
    const w = await open(identity);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    await typeName("catalog-input-step-chain", "Tools");
    expect(byId("catalog-error-step-chain")!.textContent).toContain("already names another step");
    expect(byId<HTMLInputElement>("catalog-input-step-chain")!.value).toBe("Tools");
    expect(chips(w)).toContain("Chain");
  });

  it("still lists what was renamed even when it has no activity in this period, so it can be undone", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [entry("step", "old_step", "Old thing")];
    const w = await open(identity);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    expect(byId("catalog-row-step-old_step")!.textContent).toContain("no activity in this period");
    expect(byId("catalog-reset-step-old_step")).not.toBeNull();
  });
});

describe("attribute classification in the builder and the catalog (ADR-077, phase 2)", () => {
  const splitByLabels = async (w: VueWrapper) => {
    const field = w.findAll(".field").find((f) => f.find("label").exists() && f.find("label").text().startsWith("Split by"))!;
    return optionLabels(field.element, ".select-trigger");
  };
  const pickTool = async (w: VueWrapper) => {
    await w.findAll("button.chip").find((c) => c.text().startsWith("Tool calls"))!.trigger("click");
    await flushPromises();
  };
  const moreDetails = (w: VueWrapper) => w.findAll("button.link-btn").find((b) => /more detail|fewer details/.test(b.text()));

  it("offers categories and measures to split by, and hides ids, free texts and instrumentation detail", async () => {
    const w = await open(new FakeIdentityApi());
    await pickTool(w);
    expect(await splitByLabels(w)).toEqual(["— don't break down —", "Tool", "City", "Order total"]);
    expect(moreDetails(w)!.text()).toBe("Show 3 more details");
  });

  it("shows what was hidden when asked, and hides it again", async () => {
    const w = await open(new FakeIdentityApi());
    await pickTool(w);
    await moreDetails(w)!.trigger("click");
    await flushPromises();
    expect(await splitByLabels(w)).toEqual(["— don't break down —", "Tool", "City", "Order total", "Customer id", "Message", "Memtrace step type"]);
    expect(moreDetails(w)!.text()).toBe("Show fewer details");
    await moreDetails(w)!.trigger("click");
    await flushPromises();
    expect((await splitByLabels(w)).length).toBe(4);
  });

  it("what the person forced in the catalog wins over the classification, both ways", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [
      { kind: "attribute", key: "customer_id", displayName: null, visibility: "shown", updatedAt: "t" },
      { kind: "attribute", key: "city", displayName: null, visibility: "hidden", updatedAt: "t" },
    ];
    const w = await open(identity);
    await pickTool(w);
    expect(await splitByLabels(w)).toEqual(["— don't break down —", "Tool", "Order total", "Customer id"]);
  });

  it("the editor says what each attribute is and why it is hidden", async () => {
    const w = await open(new FakeIdentityApi());
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    byId<HTMLInputElement>("catalog-technical")!.click();
    await flushPromises();
    expect(byId("catalog-kind-attribute-city")!.textContent).toContain("Category");
    expect(byId("catalog-kind-attribute-order_total")!.textContent).toContain("Number");
    expect(byId("catalog-kind-attribute-customer_id")!.textContent).toContain("Identifier");
    expect(byId("catalog-why-attribute-customer_id")!.textContent).toContain("Hidden automatically");
    expect(byId("catalog-why-attribute-message")!.textContent).toContain("free texts");
    expect(byId("catalog-why-attribute-city")).toBeNull();
    expect(byId("catalog-row-attribute-city")!.textContent).toContain("8 different values");
    expect(byId<HTMLSelectElement>("catalog-visibility-attribute-customer_id")!.options[0]!.text).toBe("Automatic (hidden)");
    expect(byId<HTMLSelectElement>("catalog-visibility-attribute-city")!.options[0]!.text).toBe("Automatic (shown)");
  });

  async function chooseVisibility(id: string, value: string) {
    const select = byId<HTMLSelectElement>(id)!;
    select.value = value;
    select.dispatchEvent(new Event("change"));
    await flushPromises();
  }

  it("forces an attribute to show or hide without touching its name, and the builder follows at once", async () => {
    const identity = new FakeIdentityApi();
    const w = await open(identity);
    await pickTool(w);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    await chooseVisibility("catalog-visibility-attribute-city", "hidden");
    expect(identity.catalogCalls.at(-1)).toEqual({ method: "save", args: ["e1", { kind: "attribute", key: "city", displayName: null, visibility: "hidden" }] });
    expect(await splitByLabels(w)).toEqual(["— don't break down —", "Tool", "Order total"]);
    // y de vuelta a automático: la fila deja de existir
    await chooseVisibility("catalog-visibility-attribute-city", "auto");
    expect(identity.chartCatalog).toEqual([]);
    expect(await splitByLabels(w)).toContain("City");
  });

  it("Reset clears the name but keeps what was forced, which has its own selector", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [{ kind: "attribute", key: "customer_id", displayName: "Customer", visibility: "shown", updatedAt: "t" }];
    const w = await open(identity);
    await w.find("[data-testid='open-catalog']").trigger("click");
    await flushPromises();
    byId("catalog-reset-attribute-customer_id")!.click();
    await flushPromises();
    expect(identity.chartCatalog).toMatchObject([{ key: "customer_id", displayName: null, visibility: "shown" }]);
    expect(byId("catalog-reset-attribute-customer_id")).toBeNull(); // sin nombre propio ya no hay nada que resetear
    expect(byId<HTMLSelectElement>("catalog-visibility-attribute-customer_id")!.value).toBe("shown");
  });
});
