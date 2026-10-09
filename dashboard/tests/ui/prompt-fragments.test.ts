import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ASSISTANT_API, CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import PromptsPage from "@/ui/pages/PromptsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi } from "../fakes";
import { FakePromptApi, promptDetail, promptSummary, promptVersion } from "../fakes-prompts";

const experiment = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

async function mountPage(component: object, path: string, props: Record<string, unknown>, prompts: FakePromptApi, role = "technical") {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
      { path: "/e/:experimentId/traces/:traceId", name: "trace", component: stub },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: {
        [TRACE_API as symbol]: new FakeTraceApi(),
        [IDENTITY_API as symbol]: new FakeIdentityApi(),
        [PROMPT_API as symbol]: prompts,
        [ASSISTANT_API as symbol]: new FakeAssistantApi(),
        [CURRENT_EXPERIMENT as symbol]: computed(() => experiment(role)),
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

const SOURCE = "Eres un asistente del tiempo.\n{{> tone@pro}}\nCiudad: {{ciudad}}.";
const RESOLVED = "Eres un asistente del tiempo.\nSé amable y breve.\nCiudad: {{ciudad}}.";

const withIncludes = (outdated = false) => {
  const api = new FakePromptApi();
  api.detail = promptDetail({
    versions: [promptVersion(1, RESOLVED, { source: SOURCE, includes: [{ name: "tone", ref: "pro", version: 1 }], variables: ["ciudad"] })],
    includes: [{ name: "tone", ref: "pro", pinned: 1, current: outdated ? 2 : 1, outdated }],
    tags: [],
  });
  return api;
};

describe("fragments in the list (ADR-073)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows fragments in their own section and keeps them out of the release board", async () => {
    const api = new FakePromptApi();
    api.list = [
      promptSummary("weather-system", { latestVersion: 2, tags: { dev: 2, pre: 2, pro: 2 } }),
      { ...promptSummary("tone"), kind: "fragment", latestVersion: 4, tags: { pro: 4 } },
    ];
    const { wrapper } = await mountPage(PromptsPage, "/e/exp-1/prompts", {}, api);
    expect(wrapper.find("[data-testid='fragment-row-tone']").text()).toContain("pro → v4");
    expect(wrapper.find("[data-testid='prompt-row-tone']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='prompt-row-weather-system']").exists()).toBe(true);
    // the board counts prompts, not fragments: one prompt in PRO
    expect(wrapper.find("[data-testid='coverage-count-pro']").text()).toBe("1");
  });

  it("creates a fragment with its own button, and explains the include syntax", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await mountPage(PromptsPage, "/e/exp-1/prompts", {}, api);
    await wrapper.find("[data-testid='new-fragment']").trigger("click");
    await flushPromises();
    const hint = document.body.querySelector("[data-testid='fragment-hint']")!.textContent!;
    expect(hint).toContain("{{> name@pro}}");
    expect(hint).toContain("{{> name@3}}");
    (document.body.querySelector("[data-testid='prompt-name']") as HTMLInputElement).value = "tone";
    document.body.querySelector("[data-testid='prompt-name']")!.dispatchEvent(new Event("input"));
    (document.body.querySelector("[data-testid='prompt-content']") as HTMLTextAreaElement).value = "Sé amable.";
    document.body.querySelector("[data-testid='prompt-content']")!.dispatchEvent(new Event("input"));
    await flushPromises();
    (document.body.querySelector("[data-testid='create-prompt']") as HTMLButtonElement).click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === "create")?.args[1]).toMatchObject({ kind: "fragment", name: "tone", content: "Sé amable." });
  });

  it("a normal prompt is created as kind prompt", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await mountPage(PromptsPage, "/e/exp-1/prompts", {}, api);
    await wrapper.find("[data-testid='new-prompt']").trigger("click");
    await flushPromises();
    expect(document.body.querySelector("[data-testid='fragment-hint']")).toBeNull();
    (document.body.querySelector("[data-testid='prompt-name']") as HTMLInputElement).value = "weather-system";
    document.body.querySelector("[data-testid='prompt-name']")!.dispatchEvent(new Event("input"));
    (document.body.querySelector("[data-testid='prompt-content']") as HTMLTextAreaElement).value = "Texto";
    document.body.querySelector("[data-testid='prompt-content']")!.dispatchEvent(new Event("input"));
    await flushPromises();
    (document.body.querySelector("[data-testid='create-prompt']") as HTMLButtonElement).click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === "create")?.args[1]).toMatchObject({ kind: "prompt" });
  });
});

describe("a prompt that includes fragments (ADR-073)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const open = (api: FakePromptApi, role = "technical") => mountPage(PromptDetailPage, "/e/exp-1/prompts/p1", { promptId: "p1" }, api, role);

  it("reads as its author wrote it, with the include visible, and can show what the agent receives", async () => {
    const { wrapper } = await open(withIncludes());
    expect(wrapper.find("[data-testid='version-content']").text()).toContain("{{> tone@pro}}");
    await wrapper.find("[data-testid='view-resolved']").trigger("click");
    expect(wrapper.find("[data-testid='version-content']").text()).toContain("Sé amable y breve.");
    expect(wrapper.find("[data-testid='version-content']").text()).not.toContain("{{> tone@pro}}");
  });

  it("lists the pinned fragments and says nothing is behind when they are current", async () => {
    const { wrapper } = await open(withIncludes());
    expect(wrapper.find("[data-testid='include-tone']").text()).toContain("tone@pro");
    expect(wrapper.find("[data-testid='include-tone']").text()).toContain("v1");
    expect(wrapper.find("[data-testid='outdated-tone']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='rebuild']").exists()).toBe(false);
  });

  it("flags a fragment that moved on and rebuilds the prompt as a draft to review", async () => {
    const api = withIncludes(true);
    const { wrapper } = await open(api);
    expect(wrapper.find("[data-testid='outdated-tone']").text()).toBe("now v2");
    await wrapper.find("[data-testid='rebuild']").trigger("click");
    await flushPromises();
    expect(api.calls.some((c) => c.method === "rebuild" && c.args[0] === "p1")).toBe(true);
  });

  it("starts the editor from the source, so editing never loses the includes", async () => {
    const api = withIncludes();
    const { wrapper } = await open(api);
    await wrapper.find("[data-testid='edit-version']").trigger("click");
    expect((wrapper.find("[data-testid='editor']").element as HTMLTextAreaElement).value).toBe(SOURCE);
    expect(wrapper.find("[data-testid='save-version']").attributes("disabled")).toBeDefined(); // unchanged source: nothing to save
  });

  it("does not offer to rebuild to someone who cannot write", async () => {
    const { wrapper } = await open(withIncludes(true), "business");
    expect(wrapper.find("[data-testid='outdated-tone']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='rebuild']").exists()).toBe(false);
  });

  it("a version without includes shows no toggle and no includes card", async () => {
    const { wrapper } = await open(new FakePromptApi());
    expect(wrapper.find("[data-testid='view-source']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='includes-card']").exists()).toBe(false);
  });
});

describe("a fragment page (ADR-073)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const fragment = (usedBy: Array<{ promptId: string; name: string; version: number; outdated: boolean }>) => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ prompt: { ...promptDetail().prompt, kind: "fragment", name: "tone" }, usedBy });
    return api;
  };
  const open = (api: FakePromptApi, role = "technical") => mountPage(PromptDetailPage, "/e/exp-1/prompts/p1", { promptId: "p1" }, api, role);

  it("lists who uses it and marks the ones that are behind", async () => {
    const { wrapper } = await open(fragment([{ promptId: "a", name: "weather-system", version: 3, outdated: true }, { promptId: "b", name: "geo", version: 1, outdated: false }]));
    expect(wrapper.find("[data-testid='used-by-weather-system']").text()).toContain("behind");
    expect(wrapper.find("[data-testid='used-by-geo']").text()).not.toContain("behind");
  });

  it("rebuilds the prompts that are behind as drafts, in one action", async () => {
    const api = fragment([{ promptId: "a", name: "weather-system", version: 3, outdated: true }, { promptId: "c", name: "billing", version: 2, outdated: true }]);
    api.rebuilt = { created: [{ promptId: "a", name: "weather-system", version: 4 }], skipped: [{ promptId: "c", name: "billing", reason: "You cannot write this prompt" }] };
    const { wrapper } = await open(api);
    expect(wrapper.find("[data-testid='rebuild-dependents']").text()).toContain("Rebuild 2 prompts as drafts");
    await wrapper.find("[data-testid='rebuild-dependents']").trigger("click");
    await flushPromises();
    expect(api.calls.some((c) => c.method === "rebuildDependents" && c.args[0] === "p1")).toBe(true);
  });

  it("explains how to start using a fragment nobody includes yet", async () => {
    const { wrapper } = await open(fragment([]));
    expect(wrapper.find("[data-testid='used-by-empty']").text()).toContain("{{> tone@pro}}");
    expect(wrapper.find("[data-testid='rebuild-dependents']").exists()).toBe(false);
  });

  it("offers the rebuild only when someone is behind", async () => {
    const { wrapper } = await open(fragment([{ promptId: "b", name: "geo", version: 1, outdated: false }]));
    expect(wrapper.find("[data-testid='rebuild-dependents']").exists()).toBe(false);
  });
});
