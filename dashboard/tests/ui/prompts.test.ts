import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type OrganizationDto } from "@/application/identity-api";
import PromptsPage from "@/ui/pages/PromptsPage.vue";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { FakePromptApi, gateResult, policy, promptDetail, promptSummary, promptVersion, versionEvidence } from "../fakes-prompts";
import { chooseOption } from "./select";

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

/** Una organización donde la persona tiene gobernanza: puede saltarse el gate de promoción (ADR-070). */
class GovernanceIdentity extends FakeIdentityApi {
  override async listOrganizations(): Promise<OrganizationDto[]> {
    return [{ id: "org-1", name: "Acme", myRole: null, permissions: permissionsOf("governance"), theme: EMPTY_THEME }];
  }
}

async function setup(component: object, role: string, api: FakePromptApi, props: Record<string, unknown> = {}, query = "", options: { identity?: FakeIdentityApi; trace?: FakeTraceApi } = {}) {
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
      provide: { [TRACE_API as symbol]: options.trace ?? new FakeTraceApi(), [IDENTITY_API as symbol]: options.identity ?? new FakeIdentityApi(), [PROMPT_API as symbol]: api, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) },
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
    expect(api.calls.find((c) => c.method === "listForAgent")).toEqual({ method: "listForAgent", args: ["exp-1", false] });
  });

  it("only offers to create prompts to people who can write them", async () => {
    const api = new FakePromptApi();
    expect((await setup(PromptsPage, "technical", api)).wrapper.find("[data-testid='new-prompt']").exists()).toBe(true);
    expect((await setup(PromptsPage, "business", api)).wrapper.find("[data-testid='new-prompt']").exists()).toBe(false);
  });

  it("explains the empty state", async () => {
    const { wrapper } = await setup(PromptsPage, "technical", new FakePromptApi());
    expect(wrapper.text()).toContain("Version what your agent says");
    expect(wrapper.find("[data-testid='empty-new-prompt']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='empty-new-fragment']").exists()).toBe(true);
  });

  it("does not offer to create anything to someone who can only read", async () => {
    const { wrapper } = await setup(PromptsPage, "business", new FakePromptApi());
    expect(wrapper.find("[data-testid='empty-state']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='empty-new-prompt']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='empty-new-fragment']").exists()).toBe(false);
  });

  it("can reach archived prompts even when nothing else exists", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(PromptsPage, "technical", api);
    await wrapper.find("[data-testid='show-archived-empty']").trigger("click");
    await flushPromises();
    expect(api.calls.filter((c) => c.method === "listForAgent").map((c) => c.args[1])).toEqual([false, true]);
  });

  it("keeps the topbar to search and the main action: archived is a switch next to the filters", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 2, tags: { dev: 2 } })];
    const { wrapper } = await setup(PromptsPage, "technical", api);
    expect(wrapper.find(".actions [data-testid='show-archived']").exists()).toBe(false);
    expect(wrapper.find(".actions [data-testid='new-fragment']").exists()).toBe(false);
    expect(wrapper.find(".toolbar [data-testid='show-archived']").exists()).toBe(true);
    await wrapper.find("[data-testid='show-archived']").setValue(true);
    await flushPromises();
    expect(api.calls.filter((c) => c.method === "listForAgent").map((c) => c.args[1])).toEqual([false, true]);
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
    expect(diff.findAll(".cell.del").length).toBeGreaterThan(0);
    expect(diff.findAll(".cell.add").length).toBeGreaterThan(0);
    expect(wrapper.find("[data-testid='prompt-diff-card']").text()).toContain("Prompt changes");
  });

  it("saves an edit as a new version from the selected one", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.find("[data-testid='edit-version']").trigger("click");
    await wrapper.find("[data-testid='editor']").setValue("Eres muy breve.");
    await wrapper.find("[data-testid='version-message']").setValue("even shorter");
    await wrapper.find("form.editor").trigger("submit");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "saveVersion")?.args).toEqual(["p1", { content: "Eres muy breve.", message: "even shorter", parentVersion: 2, draft: false }]);
  });

  it("shows who wrote each version and who moved each tag", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({
      people: { u1: "Marta", u2: "Luis" },
      versions: [promptVersion(2, "Eres breve.", { createdBy: "u2" }), promptVersion(1, "Hola {{ciudad}}.", { createdBy: "u1", variables: ["ciudad"] })],
    });
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" }, "?tab=tags");
    expect(wrapper.find("[data-testid='author-2']").text()).toBe("by Luis");
    expect(wrapper.find("[data-testid='author-1']").text()).toBe("by Marta");
    expect(wrapper.find("[data-testid='event-author-e1']").text()).toContain("by Marta");
    wrapper.unmount();
    document.body.innerHTML = "";
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
    expect(api.calls.find((c) => c.method === "moveTag")?.args).toEqual(["p1", "pre", 1, "promote to pre", null]);
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

describe("promotion gate in the prompt page (ADR-070)", () => {
  afterEach(() => {
    document.body.innerHTML = ""; // los modales teletransportados de una prueba no deben verse en la siguiente
  });

  const TAGS = 3; // Content, Compare, Evidence, Tags & history
  const withPolicy = () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ policy: policy() });
    return api;
  };
  async function openTags(api: FakePromptApi, role = "technical", options: Parameters<typeof setup>[5] = {}) {
    const ctx = await setup(PromptDetailPage, role, api, { promptId: "p1" }, "", options);
    await ctx.wrapper.findAll("[role='tab']")[TAGS]!.trigger("click");
    await flushPromises();
    return ctx;
  }
  const modal = () => document.body.querySelector<HTMLElement>("[data-testid='promote-modal']");
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);
  async function pickAndMove(wrapper: { element: Element }, env: string, label: string) {
    await chooseOption(wrapper.element, `[data-testid='env-${env}'] .select-trigger`, label);
    byId(`move-${env}`)!.click();
    await flushPromises();
  }
  async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input"));
    await flushPromises();
  }

  it("marks the protected environments only when the prompt has a policy", async () => {
    const withIt = (await openTags(withPolicy())).wrapper;
    expect(withIt.find("[data-testid='protected-pre']").exists()).toBe(true);
    expect(withIt.find("[data-testid='protected-pro']").exists()).toBe(true);
    expect(withIt.find("[data-testid='protected-dev']").exists()).toBe(false); // the first environment stays free
    document.body.innerHTML = "";
    const without = (await openTags(new FakePromptApi())).wrapper;
    expect(without.find("[data-testid='protected-pro']").exists()).toBe(false);
  });

  it("asks the gate before moving a protected environment, and promotes when it passes", async () => {
    const api = withPolicy();
    api.gate = gateResult({ allowed: true, verdict: "allowed", reason: "The evaluation of v1 passes." });
    const { wrapper } = await openTags(api);
    await pickAndMove(wrapper, "pre", "v1 · first draft");
    expect(api.calls.some((c) => c.method === "moveTag")).toBe(false); // nothing moved yet
    expect(api.calls.find((c) => c.method === "previewGate")?.args).toEqual(["p1", "pre", 1]);
    expect(byId("promote-verdict")!.textContent).toContain("Evaluation passed");
    expect(byId("promote-reason")!.textContent).toContain("passes");
    byId("promote-confirm")!.click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === "moveTag")?.args).toEqual(["p1", "pre", 1, "", null]);
    expect(modal()).toBeNull();
  });

  it("explains why an unevaluated or failing version cannot be promoted and offers no way around to a technical user", async () => {
    const api = withPolicy();
    api.gate = gateResult({
      allowed: false, verdict: "failed", reason: 'The evaluation "run 1" does not pass: accurate 70% (target 80%).',
      runs: [{ runId: "r1", name: "run 1", passed: false, failures: [{ evaluator: "accurate", passRate: 0.7, target: 0.8 }] }],
    });
    const { wrapper } = await openTags(api);
    await pickAndMove(wrapper, "pro", "v1 · first draft");
    expect(byId("promote-verdict")!.textContent).toContain("Evaluation failed");
    expect(byId("promote-failures")!.textContent).toContain("accurate");
    expect(byId("promote-failures")!.textContent).toContain("70%");
    expect(byId("promote-confirm")!.hasAttribute("disabled")).toBe(true);
    expect(byId("bypass-toggle")).toBeNull();
    expect(byId("no-bypass")!.textContent).toContain("governance");
    expect(api.calls.some((c) => c.method === "moveTag")).toBe(false);
  });

  it("lets governance skip the evaluation with a written reason, which travels with the move", async () => {
    const api = withPolicy();
    api.gate = gateResult({ allowed: false, verdict: "no_evaluation", reason: "No evaluation on the policy's dataset used v1." });
    const { wrapper } = await openTags(api, "technical", { identity: new GovernanceIdentity() });
    await pickAndMove(wrapper, "pro", "v1 · first draft");
    expect(byId("promote-confirm")!.hasAttribute("disabled")).toBe(true);
    byId<HTMLInputElement>("bypass-toggle")!.click();
    await flushPromises();
    expect(byId("promote-confirm")!.hasAttribute("disabled")).toBe(true); // a reason is required
    await type(byId<HTMLTextAreaElement>("bypass-reason")!, "Hotfix: the old answer broke checkout");
    expect(byId("promote-confirm")!.textContent).toContain("Promote anyway");
    byId("promote-confirm")!.click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === "moveTag")?.args).toEqual(["p1", "pro", 1, "", "Hotfix: the old answer broke checkout"]);
  });

  it("moves straight away, without the modal, when there is no policy or the environment is the free one", async () => {
    const free = new FakePromptApi();
    const a = await openTags(free);
    await pickAndMove(a.wrapper, "pro", "v1 · first draft");
    expect(modal()).toBeNull();
    expect(free.calls.find((c) => c.method === "moveTag")?.args.slice(0, 3)).toEqual(["p1", "pro", 1]);
    document.body.innerHTML = "";

    const guarded = withPolicy();
    const b = await openTags(guarded);
    await pickAndMove(b.wrapper, "dev", "v1 · first draft");
    expect(modal()).toBeNull();
    expect(guarded.calls.find((c) => c.method === "moveTag")?.args.slice(0, 3)).toEqual(["p1", "dev", 1]);
  });

  it("says there is no policy and what adding one does", async () => {
    const { wrapper } = await openTags(new FakePromptApi());
    expect(wrapper.find("[data-testid='policy-none']").text()).toContain("any version can be promoted");
    expect(wrapper.find("[data-testid='policy-none']").text()).toContain("pre and pro");
  });

  it("creates the policy choosing a dataset of the agent and how many runs must pass", async () => {
    const api = new FakePromptApi();
    const trace = new FakeTraceApi();
    trace.datasets = { items: [{ id: "ds1", name: "golden", createdAt: "t", runCount: 3, versionCount: 1, latestVersionMajor: 1, latestVersionMinor: 0, lastRun: null }] };
    const { wrapper } = await openTags(api, "technical", { trace });
    await wrapper.find("[data-testid='edit-policy']").trigger("click");
    await chooseOption(wrapper.element, "[data-testid='policy-dataset']", "golden");
    await wrapper.find("[data-testid='policy-runs']").setValue(3);
    await wrapper.find("[data-testid='policy-form']").trigger("submit");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "setPolicy")?.args).toEqual(["p1", { datasetId: "ds1", requiredRuns: 3 }]);
  });

  it("describes the policy, warns when its dataset was deleted, and removes it", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ policy: policy({ datasetId: null, requiredRuns: 2 }) });
    const { wrapper } = await openTags(api);
    expect(wrapper.find("[data-testid='policy-summary']").text()).toContain("2 passing evaluations in a row");
    expect(wrapper.find("[data-testid='policy-broken']").text()).toContain("promotions are blocked");
    await wrapper.find("[data-testid='remove-policy']").trigger("click");
    await flushPromises();
    expect(api.calls.some((c) => c.method === "deletePolicy")).toBe(true);
  });

  it("only offers to change the policy to someone who can promote", async () => {
    const { wrapper } = await openTags(withPolicy(), "business");
    expect(wrapper.find("[data-testid='policy-summary']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='edit-policy']").exists()).toBe(false);
  });

  it("shows in the history when someone skipped the evaluation, and why", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({
      events: [{ id: "e9", tag: "pro", fromVersion: 1, toVersion: 2, changedBy: "u1", reason: "", createdAt: "2026-10-08T12:00:00.000Z", gateVerdict: "failed", gateBypassed: true, bypassReason: "Hotfix for checkout" }],
    });
    const { wrapper } = await openTags(api);
    expect(wrapper.find("[data-testid='bypassed-e9']").text()).toContain("skipped the evaluation");
    expect(wrapper.find("[data-testid='bypassed-e9']").text()).toContain("Hotfix for checkout");
  });
});
