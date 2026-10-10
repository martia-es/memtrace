import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import CustomChartsPanel from "@/ui/components/CustomChartsPanel.vue";
import ChartCatalogTable from "@/ui/components/ChartCatalogTable.vue";
import ChartCatalogPage from "@/ui/pages/ChartCatalogPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

class Api extends FakeTraceApi {
  async getStepKinds() {
    return { items: [{ stepType: "tool", count: 2 }, { stepType: "chain", count: 6 }] };
  }
  async getAttributeKeys() {
    return { items: [{ key: "city", count: 10, kind: "category" as const, distinct: 8, numeric: false, hiddenByDefault: false }] };
  }
}

const exp = (role: string): ExperimentDto => ({ id: "e1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const RANGE = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" };

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

const provide = (identity: FakeIdentityApi, role: string) => ({ [TRACE_API as symbol]: new Api(), [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) });
const quasar: [typeof Quasar, object] = [Quasar, { plugins: { Dark, Notify } }];

async function openPanel(identity: FakeIdentityApi, role = "technical") {
  mounted = mount(CustomChartsPanel, { props: { experimentId: "e1", range: RANGE }, global: { plugins: [quasar], provide: provide(identity, role) }, attachTo: document.body });
  await flushPromises();
  return mounted;
}

async function openPage(identity: FakeIdentityApi, role = "technical") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/e/:experimentId/overview/catalog", name: "overview-catalog", component: { template: "<div />" } }] });
  await router.push("/e/e1/overview/catalog");
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(ChartCatalogPage))) });
  mounted = mount(Host, { global: { plugins: [quasar, router], provide: provide(identity, role) }, attachTo: document.body });
  await flushPromises();
  return mounted;
}

const entry = (key: string, displayName: string) => ({ kind: "step" as const, key, displayName, visibility: "auto" as const, updatedAt: "2026-10-09T10:00:00.000Z" });
const chips = (w: VueWrapper) => w.findAll("button.mt-chip").map((c) => c.text().replace(/\d+$/, "").trim());

describe("rename right where the step is picked (ADR-079)", () => {
  it("shows a clearly labelled button and a pencil per step only to people who can manage the catalog", async () => {
    const w = await openPanel(new FakeIdentityApi(), "technical");
    expect(w.find("[data-testid='open-catalog']").text()).toContain("Customize names");
    expect(w.find("[data-testid='rename-step-chain']").exists()).toBe(true);
    w.unmount();
    const g = await openPanel(new FakeIdentityApi(), "governance");
    expect(g.find("[data-testid='rename-step-chain']").exists()).toBe(false);
    expect(g.find("[data-testid='open-catalog-page']").exists()).toBe(false);
  });

  it("renames a step in place with Enter and the chip changes at once", async () => {
    const identity = new FakeIdentityApi();
    const w = await openPanel(identity);
    await w.find("[data-testid='rename-step-chain']").trigger("click");
    const input = w.find<HTMLInputElement>("[data-testid='step-rename-input']");
    await input.setValue("  Personal data filter ");
    await input.trigger("keydown.enter");
    await flushPromises();
    expect(identity.catalogCalls.at(-1)).toEqual({ method: "save", args: ["e1", { kind: "step", key: "chain", displayName: "Personal data filter", visibility: undefined }] });
    expect(chips(w)).toContain("Personal data filter");
    expect(w.find("[data-testid='step-rename-input']").exists()).toBe(false);
  });

  it("cancels with Escape without saving, and an empty name goes back to the automatic one", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [entry("chain", "Personal data filter")];
    const w = await openPanel(identity);
    await w.find("[data-testid='rename-step-chain']").trigger("click");
    await w.find("[data-testid='step-rename-input']").setValue("Something else");
    await w.find("[data-testid='step-rename-input']").trigger("keydown.esc");
    await flushPromises();
    expect(identity.catalogCalls).toEqual([]);
    expect(chips(w)).toContain("Personal data filter");

    await w.find("[data-testid='rename-step-chain']").trigger("click");
    await w.find("[data-testid='step-rename-input']").setValue("");
    await w.find("[data-testid='step-rename-input']").trigger("keydown.enter");
    await flushPromises();
    expect(chips(w)).toContain("Chain");
  });
});

describe("Data catalog page (ADR-079)", () => {
  it("lists steps and attributes, keeps edits pending and saves them all with the Save changes button", async () => {
    const identity = new FakeIdentityApi();
    const w = await openPage(identity);
    expect(w.find("[data-testid='catalog-row-step-chain']").exists()).toBe(true);
    expect(w.find("[data-testid='catalog-row-attribute-city']").exists()).toBe(true);
    expect(w.find("[data-testid='catalog-savebar']").exists()).toBe(false);

    const input = w.find<HTMLInputElement>("[data-testid='catalog-input-step-chain']");
    await input.setValue("Personal data filter");
    await input.trigger("change");
    await w.find<HTMLSelectElement>("[data-testid='catalog-visibility-attribute-city']").setValue("hidden");
    await flushPromises();
    expect(identity.catalogCalls).toEqual([]);
    expect(w.find("[data-testid='catalog-savebar']").text()).toContain("2 unsaved changes");

    await w.find("[data-testid='catalog-save']").trigger("click");
    await flushPromises();
    expect(identity.catalogCalls).toEqual([
      { method: "save", args: ["e1", { kind: "step", key: "chain", displayName: "Personal data filter", visibility: "auto" }] },
      { method: "save", args: ["e1", { kind: "attribute", key: "city", displayName: null, visibility: "hidden" }] },
    ]);
    expect(w.find("[data-testid='catalog-savebar']").exists()).toBe(false);
  });

  it("discards pending edits without saving", async () => {
    const identity = new FakeIdentityApi();
    const w = await openPage(identity);
    await w.find("[data-testid='catalog-input-step-chain']").setValue("Something");
    expect(w.find("[data-testid='catalog-savebar']").exists()).toBe(true);
    await w.find("[data-testid='catalog-discard']").trigger("click");
    expect(w.find("[data-testid='catalog-savebar']").exists()).toBe(false);
    expect(w.find<HTMLInputElement>("[data-testid='catalog-input-step-chain']").element.value).toBe("");
    expect(identity.catalogCalls).toEqual([]);
  });

  it("filters by technical key or by the visible name", async () => {
    const identity = new FakeIdentityApi();
    identity.chartCatalog = [entry("chain", "Personal data filter")];
    const w = await openPage(identity);
    await w.find("[data-testid='catalog-search']").setValue("personal");
    expect(w.find("[data-testid='catalog-row-step-chain']").exists()).toBe(true);
    expect(w.find("[data-testid='catalog-row-step-tool']").exists()).toBe(false);
    await w.find("[data-testid='catalog-search']").setValue("zzz");
    expect(w.find("[data-testid='catalog-empty-step']").text()).toContain("Nothing matches");
  });

  it("looks at what the agent reports again when the period changes, keeping pending edits", async () => {
    const calls: unknown[] = [];
    class Counting extends Api {
      async getStepKinds(...args: unknown[]) {
        calls.push(args[0]);
        return super.getStepKinds();
      }
    }
    const identity = new FakeIdentityApi();
    const table = mount(ChartCatalogTable, {
      props: { experimentId: "e1", range: RANGE, entries: [], manual: true },
      global: { plugins: [quasar], provide: { ...provide(identity, "technical"), [TRACE_API as symbol]: new Counting() } },
      attachTo: document.body,
    });
    mounted = table;
    await flushPromises();
    await table.find("[data-testid='catalog-input-step-chain']").setValue("Mine");
    await table.setProps({ range: { from: "2026-09-10T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" } });
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(table.find<HTMLInputElement>("[data-testid='catalog-input-step-chain']").element.value).toBe("Mine");
  });

  it("is read-only for people without the catalog permission", async () => {
    const w = await openPage(new FakeIdentityApi(), "governance");
    expect(w.find<HTMLInputElement>("[data-testid='catalog-input-step-chain']").element.disabled).toBe(true);
    expect(w.text()).toContain("You can look but not change it");
  });
});
