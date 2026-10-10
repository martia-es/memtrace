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

describe("prompts list: release table", () => {
  it("warns how many prompts run behind in PRO and shows each environment's version in one row", async () => {
    const api = new FakePromptApi();
    api.list = [
      promptSummary("weather-system", { latestVersion: 12, tags: { dev: 12, pre: 11, pro: 9 } }),
      promptSummary("refund-policy", { latestVersion: 7, tags: { dev: 7, pre: 7, pro: 7 } }),
      promptSummary("alert-summarizer", { latestVersion: 3, tags: { dev: 3 } }),
    ];
    const wrapper = await setup(PromptsPage, api);
    expect(wrapper.find("[data-testid='drift']").text()).toContain("1 prompt runs behind the latest version in PRO");
    expect(wrapper.find("[data-testid='drift']").text()).toContain("3 versions are waiting");
    expect(wrapper.find("[data-testid='tag-weather-system-pro']").text()).toContain("3 behind");
    expect(wrapper.find("[data-testid='tag-weather-system-pre']").text()).toBe("v11");
    expect(wrapper.find("[data-testid='tag-refund-policy-pro']").text()).toBe("v7");
    expect(wrapper.find("[data-testid='tag-alert-summarizer-pro']").text()).toBe("—");
    expect(wrapper.find("[data-testid='release-weather-system']").text()).toBe("3 versions behind in PRO");
    expect(wrapper.find("[data-testid='release-refund-policy']").text()).toBe("In sync");
    expect(wrapper.find("[data-testid='release-alert-summarizer']").text()).toBe("Not released");
  });

  it("filters the list by release status, from the alert or the status filter, and keeps it in the URL", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 12, tags: { pro: 9 } }), promptSummary("refund-policy", { latestVersion: 7, tags: { pro: 7 } })];
    const wrapper = await setup(PromptsPage, api);
    expect(rows(wrapper)).toHaveLength(2);
    await wrapper.find("[data-testid='show-behind']").trigger("click");
    await flushPromises();
    expect(rows(wrapper)).toEqual(["prompt-row-weather-system"]);
    // the alert has nothing left to offer once the list is already filtered
    expect(wrapper.find("[data-testid='show-behind']").exists()).toBe(false);
  });

  it("shows no alert when production is up to date everywhere", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("refund-policy", { latestVersion: 7, tags: { dev: 7, pre: 7, pro: 7 } })];
    const wrapper = await setup(PromptsPage, api);
    expect(wrapper.find("[data-testid='drift']").exists()).toBe(false);
  });

  it("lists fragments on their own, behind the Prompts | Fragments switch", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 2, tags: { pro: 2 } }), { ...promptSummary("tone"), kind: "fragment" as const, latestVersion: 1, tags: {} }];
    const wrapper = await setup(PromptsPage, api);
    expect(rows(wrapper)).toEqual(["prompt-row-weather-system"]);
    expect(wrapper.find("[data-testid='fragments']").exists()).toBe(false);
    await wrapper.find("[data-testid='kind-fragments']").trigger("click");
    await flushPromises();
    expect(rows(wrapper)).toEqual([]);
    expect(wrapper.find("[data-testid='fragment-row-tone']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='new-fragment']").exists()).toBe(true);
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

  it("says how far production is behind the latest version, and offers to promote it", async () => {
    const wrapper = await setup(PromptDetailPage, withProduction(), { promptId: "p1" });
    expect(wrapper.find("[data-testid='env-card-pro']").text()).toContain("v1");
    expect(wrapper.find("[data-testid='env-note-pro']").text()).toBe("1 version behind");
    expect(wrapper.find("[data-testid='env-note-dev']").text()).toBe("Up to date");
    expect(wrapper.find("[data-testid='promote-pro']").text()).toBe("Promote v2");
    expect(wrapper.find("[data-testid='promote-dev']").exists()).toBe(false);
  });

  it("shows no promote button when production has the latest version", async () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ tags: [tag("dev", 2), tag("pro", 2)] });
    const wrapper = await setup(PromptDetailPage, api, { promptId: "p1" });
    expect(wrapper.find("[data-testid='env-note-pro']").text()).toBe("Up to date");
    expect(wrapper.find("[data-testid='promote-pro']").exists()).toBe(false);
  });

  it("marks the lines that changed since the version it came from", async () => {
    const wrapper = await setup(PromptDetailPage, new FakePromptApi(), { promptId: "p1" });
    expect(wrapper.findAll(".ln.changed").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("Lines changed since v1");
  });
});
