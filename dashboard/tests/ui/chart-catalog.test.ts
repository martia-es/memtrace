import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { computed } from "vue";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import CustomChartsPanel from "@/ui/components/CustomChartsPanel.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

class Api extends FakeTraceApi {
  async getStepKinds() {
    return { items: [{ stepType: "tool", count: 2 }, { stepType: "chain", count: 6 }] };
  }
  async getAttributeKeys() {
    return { items: [{ key: "gen_ai.tool.name", count: 2 }, { key: "city", count: 4 }, { key: "memtrace.step_type", count: 8 }] };
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
