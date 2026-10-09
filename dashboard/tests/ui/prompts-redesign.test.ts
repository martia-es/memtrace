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
import { FakePromptApi, promptDetail, promptSummary } from "../fakes-prompts";

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

async function setup(component: object, api: FakePromptApi, props: Record<string, unknown> = {}) {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
    ],
  });
  await router.push("/e/exp-1/prompts");
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: new FakeIdentityApi(), [PROMPT_API as symbol]: api, [CURRENT_EXPERIMENT as symbol]: computed(() => exp("technical")) },
    },
  });
  await flushPromises();
  return wrapper;
}

const tag = (name: string, version: number) => ({ tag: name, version, updatedBy: "u1", updatedAt: "2026-10-08T10:05:00.000Z" });
const rows = (wrapper: { findAll: (s: string) => { attributes: (n: string) => string | undefined }[] }) => wrapper.findAll("[data-testid^='prompt-row-']").map((r) => r.attributes("data-testid"));

describe("prompts list: release board", () => {
  it("shows what is live in each environment and how many prompts run behind in PRO", async () => {
    const api = new FakePromptApi();
    api.list = [
      promptSummary("weather-system", { latestVersion: 12, tags: { dev: 12, pre: 11, pro: 9 } }),
      promptSummary("refund-policy", { latestVersion: 7, tags: { dev: 7, pre: 7, pro: 7 } }),
      promptSummary("alert-summarizer", { latestVersion: 3, tags: { dev: 3 } }),
    ];
    const wrapper = await setup(PromptsPage, api);
    expect(wrapper.find("[data-testid='coverage-count-dev']").text()).toBe("3");
    expect(wrapper.find("[data-testid='coverage-count-pre']").text()).toBe("2");
    expect(wrapper.find("[data-testid='coverage-count-pro']").text()).toBe("2");
    expect(wrapper.find("[data-testid='coverage-pro']").text()).toContain("of 3 pinned");
    expect(wrapper.find("[data-testid='coverage-pro']").text()).toContain("1 prompt never reached PRO");
    expect(wrapper.find("[data-testid='drift']").text()).toContain("1 prompt");
    expect(wrapper.find("[data-testid='drift']").text()).toContain("3 versions waiting");
    expect(wrapper.find("[data-testid='release-weather-system']").text()).toBe("3 versions behind in PRO");
    expect(wrapper.find("[data-testid='release-refund-policy']").text()).toBe("In sync");
    expect(wrapper.find("[data-testid='release-alert-summarizer']").text()).toBe("Not released");
  });

  it("filters the list by release status", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 12, tags: { pro: 9 } }), promptSummary("refund-policy", { latestVersion: 7, tags: { pro: 7 } })];
    const wrapper = await setup(PromptsPage, api);
    expect(rows(wrapper)).toHaveLength(2);
    await wrapper.find("[data-testid='status-behind']").trigger("click");
    expect(rows(wrapper)).toEqual(["prompt-row-weather-system"]);
    await wrapper.find("[data-testid='status-in_sync']").trigger("click");
    expect(rows(wrapper)).toEqual(["prompt-row-refund-policy"]);
  });

  it("says when production is up to date everywhere", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("refund-policy", { latestVersion: 7, tags: { dev: 7, pre: 7, pro: 7 } })];
    const wrapper = await setup(PromptsPage, api);
    expect(wrapper.find("[data-testid='drift']").text()).toContain("All released");
  });
});

describe("prompt detail: version rail", () => {
  const withProduction = () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ tags: [tag("dev", 2), tag("pro", 1)] });
    return api;
  };

  it("pins the versions the tags point at and finds a version by number or message", async () => {
    const wrapper = await setup(PromptDetailPage, withProduction(), { promptId: "p1" });
    expect(wrapper.find("[data-testid='pinned-pro']").text()).toContain("v1");
    await wrapper.find("[data-testid='pinned-pro']").trigger("click");
    expect(wrapper.find("[data-testid='version-content']").text()).toContain("Eres un asistente del tiempo");
    await wrapper.find("[data-testid='version-search']").setValue("shorter");
    expect(wrapper.find("[data-testid='version-2']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='version-1']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='pinned']").exists()).toBe(false); // while searching, only the matches
    await wrapper.find("[data-testid='version-search']").setValue("nothing like this");
    expect(wrapper.find("[data-testid='no-versions']").exists()).toBe(true);
  });

  it("says how far production is behind the latest version", async () => {
    const wrapper = await setup(PromptDetailPage, withProduction(), { promptId: "p1" });
    expect(wrapper.find("[data-testid='running-strip']").text()).toContain("v2");
    expect(wrapper.find("[data-testid='behind-pill']").text()).toBe("PRO is 1 version behind");
  });

  it("does not show the behind pill when production has the latest version", async () => {
    const wrapper = await setup(PromptDetailPage, new FakePromptApi(), { promptId: "p1" });
    expect(wrapper.find("[data-testid='behind-pill']").exists()).toBe(false);
  });

  it("shows only the text in Content: changes live in Compare", async () => {
    const wrapper = await setup(PromptDetailPage, new FakePromptApi(), { promptId: "p1" });
    expect(wrapper.findAll(".ln.changed").length).toBe(0);
    expect(wrapper.text()).not.toContain("Lines changed since");
  });
});
