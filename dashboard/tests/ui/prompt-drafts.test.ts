import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ASSISTANT_API, CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import { permissionsOf } from "../permissions";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi, assistantCard, deploymentDto, node, traceDetail } from "../fakes";
import { FakePromptApi, promptDetail, promptSummary, promptVersion } from "../fakes-prompts";

const experiment = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const TRACE = "ab".repeat(16);

async function mountPage(component: object, path: string, props: Record<string, unknown>, apis: { prompts?: FakePromptApi; traces?: FakeTraceApi } = {}, role = "technical") {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
      { path: "/e/:experimentId/traces/:traceId", name: "trace", component: stub },
      { path: "/e/:experimentId/conversations", name: "conversations", component: stub },
      { path: "/e/:experimentId/conversations/:conversationId", name: "conversation", component: stub },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const assistants = new FakeAssistantApi();
  assistants.card = assistantCard({ chat: { path: "/chat", requestField: "message", responseField: "reply", sessionField: null, traceIdField: null }, deployments: [deploymentDto("dev", "up", { authMethod: "none" })] });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: {
        [TRACE_API as symbol]: apis.traces ?? new FakeTraceApi(),
        [IDENTITY_API as symbol]: new FakeIdentityApi(),
        [PROMPT_API as symbol]: apis.prompts ?? new FakePromptApi(),
        [ASSISTANT_API as symbol]: assistants,
        [CURRENT_EXPERIMENT as symbol]: computed(() => experiment(role)),
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

const withDraft = () => {
  const api = new FakePromptApi();
  api.detail = promptDetail({
    versions: [
      promptVersion(3, "Borrador {{ciudad}}", { status: "draft", publishedAt: null, parentVersion: 2, message: "Proposed fix", origin: { kind: "fix", traceIds: [TRACE], cause: "429 Too Many Requests", rationale: "Shorter prompt, fewer tokens" } }),
      promptVersion(2, "Eres breve.\nResponde en español.", { message: "shorter" }),
      promptVersion(1, "Eres un asistente del tiempo para {{ciudad}}.\nResponde en español.", { variables: ["ciudad"], message: "first draft" }),
    ],
  });
  return api;
};

describe("drafts in the prompt page (ADR-072)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const open = (api: FakePromptApi, role = "technical", query = "") => mountPage(PromptDetailPage, `/e/exp-1/prompts/p1${query}`, { promptId: "p1" }, { prompts: api }, role);

  it("marks drafts in the version rail and opens on the latest PUBLISHED version, not on the draft", async () => {
    const { wrapper } = await open(withDraft());
    expect(wrapper.find("[data-testid='draft-3']").text()).toBe("draft");
    expect(wrapper.find("[data-testid='draft-2']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='draft-banner']").exists()).toBe(false); // v2 is selected
    expect(wrapper.find("[data-testid='version-content']").text()).toContain("Eres breve");
  });

  it("explains a draft: not reviewed, where it comes from and why, with a link to the failed trace", async () => {
    const { wrapper } = await open(withDraft());
    await wrapper.find("[data-testid='version-3']").trigger("click");
    const banner = wrapper.find("[data-testid='draft-banner']");
    expect(banner.text()).toContain("not reviewed yet");
    expect(banner.text()).toContain("429 Too Many Requests");
    expect(wrapper.find("[data-testid='draft-rationale']").text()).toContain("Shorter prompt");
    expect(banner.find("a").text()).toBe(TRACE.slice(0, 8));
  });

  it("publishes a draft", async () => {
    const api = withDraft();
    const { wrapper } = await open(api);
    await wrapper.find("[data-testid='version-3']").trigger("click");
    await wrapper.find("[data-testid='draft-publish']").trigger("click");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "publishDraft")?.args).toEqual(["p1", 3]);
  });

  it("discards a draft", async () => {
    const api = withDraft();
    const { wrapper } = await open(api);
    await wrapper.find("[data-testid='version-3']").trigger("click");
    await wrapper.find("[data-testid='draft-discard']").trigger("click");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "discardDraft")?.args).toEqual(["p1", 3]);
  });

  it("tests a draft in the real agent against the version it came from", async () => {
    const { wrapper } = await open(withDraft());
    await wrapper.find("[data-testid='version-3']").trigger("click");
    await wrapper.find("[data-testid='draft-test']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='pane-try']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='playground-first']").text()).toContain("v3");
    expect(wrapper.find("[data-testid='playground-second']").text()).toContain("v2");
  });

  it("only offers publish and discard to someone who can write", async () => {
    const { wrapper } = await open(withDraft(), "business");
    await wrapper.find("[data-testid='version-3']").trigger("click");
    expect(wrapper.find("[data-testid='draft-banner']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='draft-publish']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='draft-discard']").exists()).toBe(false);
  });

  it("saves the editor as a draft without publishing anything", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await open(api);
    await wrapper.find("[data-testid='edit-version']").trigger("click");
    await wrapper.find("[data-testid='editor']").setValue("Eres muy breve.");
    await wrapper.find("[data-testid='save-draft']").trigger("click");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "saveVersion")?.args).toEqual(["p1", { content: "Eres muy breve.", message: "", parentVersion: 2, draft: true }]);
  });

  it("never offers a draft as the target of a tag", async () => {
    const { wrapper } = await open(withDraft(), "technical", "?tab=tags");
    await wrapper.findAll("[role='tab']")[3]!.trigger("click");
    await flushPromises();
    const select = wrapper.find("[data-testid='env-pre'] .select-trigger");
    select.element.dispatchEvent(new Event("click"));
    await flushPromises();
    const options = [...wrapper.element.querySelectorAll("[data-testid='env-pre'] .select-option")].map((o) => o.textContent?.trim());
    expect(options.join(" ")).not.toContain("v3");
    expect(options.join(" ")).toContain("v2");
  });

  it("measures how far production is behind against the latest published version, not a draft", async () => {
    const api = withDraft();
    api.detail = { ...api.detail, tags: [{ tag: "pro", version: 2, updatedBy: null, updatedAt: "t" }] };
    const { wrapper } = await open(api);
    expect(wrapper.find("[data-testid='behind-pill']").exists()).toBe(false); // pro is on v2, the latest published
  });
});

describe("fix a failure (ADR-072)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const failingTrace = (usedVersion = 1) => {
    const traces = new FakeTraceApi();
    const tool = node({ spanId: "t1", name: "get_weather", status: { code: "error", message: "429 Too Many Requests" } });
    const llm = node({
      spanId: "l1", attributes: { "memtrace.prompt.name": "weather-system", "memtrace.prompt.version": String(usedVersion) },
      content: { inputMessages: [{ role: "user", content: "¿Lloverá en Sevilla?" }], outputMessages: [{ role: "assistant", content: "No lo sé" }] },
    });
    traces.detail = traceDetail({ errorCount: 1, status: "error", roots: [node({ children: [llm, tool] })] });
    return traces;
  };
  const openFix = (apis: { prompts?: FakePromptApi; traces?: FakeTraceApi }, query = `?tab=fix&trace=${TRACE}`) => mountPage(PromptDetailPage, `/e/exp-1/prompts/p1${query}`, { promptId: "p1" }, apis);

  it("shows what failed, the case, and starts the editor from the version that trace used", async () => {
    const { wrapper } = await openFix({ traces: failingTrace(1) });
    expect(wrapper.find("[data-testid='fix-failure']").text()).toContain("get_weather");
    expect(wrapper.find("[data-testid='fix-failure']").text()).toContain("429 Too Many Requests");
    expect(wrapper.find("[data-testid='fix-failure']").text()).toContain("¿Lloverá en Sevilla?");
    expect(wrapper.find("[data-testid='fix-used']").text()).toContain("v1");
    expect((wrapper.find("[data-testid='fix-content']").element as HTMLTextAreaElement).value).toContain("Eres un asistente del tiempo");
    expect((wrapper.find("[data-testid='fix-rationale']").element as HTMLTextAreaElement).value).toContain("429 Too Many Requests");
  });

  it("saves the proposal as a draft with the failure as its origin, and never publishes", async () => {
    const prompts = new FakePromptApi();
    const { wrapper } = await openFix({ prompts, traces: failingTrace(1) });
    expect(wrapper.find("[data-testid='fix-save']").attributes("disabled")).toBeDefined(); // unchanged text: nothing to save
    await wrapper.find("[data-testid='fix-content']").setValue("Eres un asistente del tiempo para {{ciudad}}. Si la API falla, dilo.");
    await wrapper.find("[data-testid='fix-save']").trigger("click");
    await flushPromises();
    const call = prompts.calls.find((c) => c.method === "saveVersion")!;
    expect(call.args[1]).toMatchObject({
      draft: true, parentVersion: 1, message: "Proposed fix",
      origin: { traceIds: [TRACE], cause: "429 Too Many Requests" },
    });
    expect(prompts.calls.some((c) => c.method === "publishDraft")).toBe(false);
    expect(wrapper.find("[data-testid='fix-saved']").text()).toContain("not published");
  });

  it("goes from the saved draft to testing it on the same case, against the version it fixes", async () => {
    const { wrapper } = await openFix({ traces: failingTrace(1) });
    await wrapper.find("[data-testid='fix-content']").setValue("Otro texto {{ciudad}}");
    await wrapper.find("[data-testid='fix-save']").trigger("click");
    await flushPromises();
    await wrapper.find("[data-testid='fix-test']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='pane-try']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='playground-first']").text()).toContain("v3");
    expect(wrapper.find("[data-testid='playground-second']").text()).toContain("v1");
    expect((wrapper.find("[data-testid='playground-message']").element as HTMLTextAreaElement).value).toBe("¿Lloverá en Sevilla?");
  });

  it("says when the trace has no failure, and still lets you write a proposal", async () => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ roots: [node()] });
    const { wrapper } = await openFix({ traces });
    expect(wrapper.find("[data-testid='fix-no-failure']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='fix-unknown-version']").exists()).toBe(true);
  });

  it("starts empty when no trace is given, and points to the SDK for model-written proposals", async () => {
    const { wrapper } = await openFix({}, "?tab=fix");
    expect(wrapper.find("[data-testid='fix-failure']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='fix-tip']").text()).toContain("propose_fix");
  });
});

describe("fix button on the trace page (ADR-072)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const stamped = node({ attributes: { "memtrace.prompt.name": "weather-system", "memtrace.prompt.version": "3" } });
  const open = (errorCount: number) => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ errorCount, roots: [node({ children: [stamped] })] });
    const prompts = new FakePromptApi();
    prompts.list = [{ ...promptSummary("weather-system"), id: "p-weather" }];
    return mountPage(TraceDetailPage, `/e/exp-1/traces/${"a".repeat(32)}`, { traceId: "a".repeat(32) }, { traces, prompts });
  };

  it("offers to fix a failed trace that read its prompt from the registry, and opens the Fix tab with that trace", async () => {
    const { wrapper, router } = await open(1);
    await wrapper.find("[data-testid='fix-btn']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params).toMatchObject({ promptId: "p-weather" });
    expect(router.currentRoute.value.query).toMatchObject({ tab: "fix", trace: "a".repeat(32) });
  });

  it("does not offer it for a trace that did not fail", async () => {
    const { wrapper } = await open(0);
    expect(wrapper.find("[data-testid='fix-btn']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='replay-btn']").exists()).toBe(true);
  });
});
