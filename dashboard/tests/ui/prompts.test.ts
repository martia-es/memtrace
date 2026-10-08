import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import PromptsPage from "@/ui/pages/PromptsPage.vue";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { FakePromptApi, promptDetail, promptSummary, promptVersion, versionEvidence } from "../fakes-prompts";
import { chooseOption } from "./select";

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

async function setup(component: object, role: string, api: FakePromptApi, props: Record<string, unknown> = {}, query = "") {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
    ],
  });
  await router.push(`/e/exp-1/prompts${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: new FakeIdentityApi(), [PROMPT_API as symbol]: api, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("prompts list (ADR-067)", () => {
  it("lists the agent's prompts with their latest version and the version each tag points to", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 3, tags: { dev: 3, pro: 2 }, description: "Main prompt" }), promptSummary("geo-tools", { latestVersion: 1 })];
    const { wrapper } = await setup(PromptsPage, "technical", api);
    expect(wrapper.findAll("[data-testid^='prompt-row-']")).toHaveLength(2);
    expect(wrapper.text()).toContain("v3");
    expect(wrapper.find("[data-testid='tag-weather-system-dev']").text()).toBe("dev → v3");
    expect(wrapper.find("[data-testid='tag-weather-system-pro']").text()).toBe("pro → v2");
    expect(api.calls[0]).toEqual({ method: "listForAgent", args: ["exp-1", false] });
  });

  it("only offers to create prompts to people who can write them", async () => {
    const api = new FakePromptApi();
    expect((await setup(PromptsPage, "technical", api)).wrapper.find("[data-testid='new-prompt']").exists()).toBe(true);
    expect((await setup(PromptsPage, "business", api)).wrapper.find("[data-testid='new-prompt']").exists()).toBe(false);
  });

  it("explains the empty state", async () => {
    const { wrapper } = await setup(PromptsPage, "technical", new FakePromptApi());
    expect(wrapper.text()).toContain("No prompts yet");
  });
});

describe("prompt detail (ADR-067)", () => {
  it("shows the latest version, its variables and the tags that point at each version", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ versions: [promptVersion(2, "Nuevo {{ciudad}}", { variables: ["ciudad"], message: "shorter" }), promptVersion(1, "Antiguo")] });
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    expect(wrapper.find("[data-testid='version-content']").text()).toBe("Nuevo {{ciudad}}");
    expect(wrapper.text()).toContain("{{ciudad}}");
    expect(wrapper.find("[data-testid='version-2']").text()).toContain("dev");
    expect(wrapper.find("[data-testid='version-1']").text()).not.toContain("dev");
  });

  it("compares a version with the one it came from, line by line", async () => {
    const { wrapper } = await setup(PromptDetailPage, "technical", new FakePromptApi(), { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[1]!.trigger("click");
    const diff = wrapper.find("[data-testid='prompt-diff']");
    expect(diff.exists()).toBe(true);
    expect(diff.text()).toContain("Eres breve.");
    expect(diff.text()).toContain("Eres un asistente del tiempo para {{ciudad}}.");
    expect(diff.findAll(".line.del").length).toBeGreaterThan(0);
    expect(diff.findAll(".line.add").length).toBeGreaterThan(0);
  });

  it("saves an edit as a new version from the selected one", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.find("[data-testid='edit-version']").trigger("click");
    await wrapper.find("[data-testid='editor']").setValue("Eres muy breve.");
    await wrapper.find("[data-testid='version-message']").setValue("even shorter");
    await wrapper.find("form.editor").trigger("submit");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "saveVersion")?.args).toEqual(["p1", { content: "Eres muy breve.", message: "even shorter", parentVersion: 2 }]);
  });

  it("does not offer to edit to someone who can only read", async () => {
    const { wrapper } = await setup(PromptDetailPage, "business", new FakePromptApi(), { promptId: "p1" });
    expect(wrapper.find("[data-testid='edit-version']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='toggle-archived']").exists()).toBe(false);
  });

  it("moves an environment tag to another version and records the reason", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" }, "?tab=tags");
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    await wrapper.find("[data-testid='tag-reason']").setValue("promote to pre");
    await chooseOption(document.body, "[data-testid='env-pre'] .select-trigger", "v1 · first draft");
    await wrapper.find("[data-testid='move-pre']").trigger("click");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "moveTag")?.args).toEqual(["p1", "pre", 1, "promote to pre"]);
    expect(wrapper.find("[data-testid='tag-events']").text()).toContain("ready to test");
  });

  it("shows the evidence of every version with traffic: traces, errors, latency, cost, thumbs-up, evaluators and the main failure", async () => {
    const api = new FakePromptApi();
    api.evidence = {
      range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" },
      versions: [
        versionEvidence(2, { traces: 200, errorRate: 0.02, latencyMs: { p50: 500, p95: 1500 }, costPerTraceUsd: 0.004, evaluators: [{ name: "accurate", dataType: "boolean", items: 20, value: 0.9 }] }),
        versionEvidence(1, { traces: 12, errorRate: 0.25, errorCauses: [{ id: "quota_exceeded", title: "The AI provider's quota ran out", severity: "high", traces: 3 }], evaluators: [{ name: "accurate", dataType: "boolean", items: 8, value: 0.5 }] }),
      ],
    };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[2]!.trigger("click");
    await flushPromises();
    const call = api.calls.find((c) => c.method === "getEvidence")!;
    expect(call.args.slice(0, 2)).toEqual(["exp-1", "p1"]);
    const v2 = wrapper.find("[data-testid='evidence-v2']").text();
    expect(v2).toContain("200");
    expect(v2).toContain("2.0%");
    expect(v2).toContain("$0.0040");
    expect(v2).toContain("90%"); // accurate
    const v1 = wrapper.find("[data-testid='evidence-v1']");
    expect(v1.text()).toContain("few traces"); // 12 traces: the figures are only indicative
    expect(wrapper.find("[data-testid='evidence-v2']").text()).not.toContain("few traces");
    expect(wrapper.find("[data-testid='cause-v1']").text()).toContain("The AI provider's quota ran out");
  });

  it("asks for another period when the range changes", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[2]!.trigger("click");
    await flushPromises();
    // acotado a este componente: los de otras pruebas siguen montados en el body
    await chooseOption(wrapper.element, "[data-testid='evidence-range']", "24 hours");
    const ranges = api.calls.filter((c) => c.method === "getEvidence").map((c) => c.args[2] as { from: Date; to: Date });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.to.getTime() - ranges[0]!.from.getTime()).toBe(7 * 24 * 3600_000);
    expect(ranges[1]!.to.getTime() - ranges[1]!.from.getTime()).toBe(24 * 3600_000);
  });

  it("explains an empty period", async () => {
    const { wrapper } = await setup(PromptDetailPage, "technical", new FakePromptApi(), { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='evidence-empty']").text()).toContain("No trace used this prompt");
  });

  it("puts the behaviour of the two compared versions next to their text diff, saying what got better or worse", async () => {
    const api = new FakePromptApi();
    api.evidence = {
      range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" },
      versions: [
        versionEvidence(2, { errorRate: 0.02, latencyMs: { p50: 500, p95: 2900 }, costPerTraceUsd: 0.01 }),
        versionEvidence(1, { errorRate: 0.1, latencyMs: { p50: 800, p95: 2400 }, costPerTraceUsd: 0.01 }),
      ],
    };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='delta-errorRate']").text()).toContain("Better");
    expect(wrapper.find("[data-testid='delta-errorRate']").text()).toContain("−8.0 pp");
    expect(wrapper.find("[data-testid='delta-p95']").text()).toContain("Worse");
    expect(wrapper.find("[data-testid='delta-cost']").text()).toContain("No change");
    expect(wrapper.find("[data-testid='behaviour-unreliable']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='prompt-diff']").exists()).toBe(true); // the text diff is still there
  });

  it("warns that the differences may be chance when a version has few traces", async () => {
    const api = new FakePromptApi();
    api.evidence = { range: { from: "a", to: "b" }, versions: [versionEvidence(2, { traces: 400 }), versionEvidence(1, { traces: 7 })] };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='behaviour-unreliable']").text()).toContain("fewer than 30 traces");
  });

  it("says which version has no traffic instead of comparing against nothing", async () => {
    const api = new FakePromptApi();
    api.evidence = { range: { from: "a", to: "b" }, versions: [versionEvidence(2)] };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='behaviour-empty']").text()).toContain("v1");
    expect(wrapper.find("[data-testid='prompt-diff']").exists()).toBe(true);
  });

  it("shows which version each agent really runs, and flags the ones that have not caught up with the tag", async () => {
    const api = new FakePromptApi();
    const seen = (extra: object) => ({ experimentId: "exp-1", environment: "dev", tag: "dev", version: 2, lastSeenAt: new Date().toISOString(), active: true, ...extra });
    api.detail = promptDetail({ usage: [seen({}), seen({ environment: "pro", tag: "pro", version: 1 }), seen({ environment: "pre", tag: "pre", version: 1, active: false })] });
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    // la lista de versiones marca dónde corre cada una
    expect(wrapper.find("[data-testid='running-2']").text()).toBe("Running in dev");
    expect(wrapper.find("[data-testid='running-1']").text()).toBe("Running in pro"); // "pre" no informa: no cuenta
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    const table = wrapper.find("[data-testid='usage-table']");
    expect(table.find("[data-testid='usage-dev-v2']").text()).toContain("Up to date");
    expect(table.find("[data-testid='usage-pre-v1']").text()).toContain("Not reporting");
    // el tag "pro" no existe en el detalle de prueba: no hay nada con lo que desfasarse
    expect(table.find("[data-testid='usage-pro-v1']").text()).toContain("Up to date");
  });

  it("flags an agent that still runs an older version than its tag points to", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ usage: [{ experimentId: "exp-1", environment: "dev", tag: "dev", version: 1, lastSeenAt: new Date().toISOString(), active: true }] });
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    const row = wrapper.find("[data-testid='usage-dev-v1']");
    expect(row.text()).toContain("Catching up");
    expect(row.text()).toContain("now points to v2");
  });

  it("explains how an agent shows up when none has reported yet", async () => {
    const { wrapper } = await setup(PromptDetailPage, "technical", new FakePromptApi(), { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    expect(wrapper.find("[data-testid='usage-empty']").text()).toContain("prompts.get()");
  });

  it("hides the environment controls from people without the promote permission", async () => {
    const { wrapper } = await setup(PromptDetailPage, "business", new FakePromptApi(), { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    expect(wrapper.find("[data-testid='move-pre']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='env-dev']").text()).toContain("v2");
  });
});
