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
import { FakePromptApi, promptDetail, promptSummary, promptVersion } from "../fakes-prompts";
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
    await wrapper.findAll("[role='tab']")[2]!.trigger("click");
    await wrapper.find("[data-testid='tag-reason']").setValue("promote to pre");
    await chooseOption(document.body, "[data-testid='env-pre'] .select-trigger", "v1 · first draft");
    await wrapper.find("[data-testid='move-pre']").trigger("click");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "moveTag")?.args).toEqual(["p1", "pre", 1, "promote to pre"]);
    expect(wrapper.find("[data-testid='tag-events']").text()).toContain("ready to test");
  });

  it("hides the environment controls from people without the promote permission", async () => {
    const { wrapper } = await setup(PromptDetailPage, "business", new FakePromptApi(), { promptId: "p1" });
    await wrapper.findAll("[role='tab']")[2]!.trigger("click");
    expect(wrapper.find("[data-testid='move-pre']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='env-dev']").text()).toContain("v2");
  });
});
