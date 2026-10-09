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
import { FakePromptApi, promptDetail, promptSummary } from "../fakes-prompts";
import { chooseOption } from "./select";

const exp: ExperimentDto = { id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: "technical", permissions: permissionsOf("technical"), organizationTheme: EMPTY_THEME };
const chat = { path: "/api/chat", requestField: "message", responseField: "reply", sessionField: null, traceIdField: "trace_id" };
const open = (key: string) => deploymentDto(key, "up", { authMethod: "none" });

async function mountPage(component: object, path: string, props: Record<string, unknown>, apis: { prompts?: FakePromptApi; assistants?: FakeAssistantApi; traces?: FakeTraceApi } = {}) {
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
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: {
        [TRACE_API as symbol]: apis.traces ?? new FakeTraceApi(),
        [IDENTITY_API as symbol]: new FakeIdentityApi(),
        [PROMPT_API as symbol]: apis.prompts ?? new FakePromptApi(),
        [ASSISTANT_API as symbol]: apis.assistants ?? new FakeAssistantApi(),
        [CURRENT_EXPERIMENT as symbol]: computed(() => exp),
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

const agent = (deployments = [open("dev"), open("pro")], hasChat = true) => {
  const assistants = new FakeAssistantApi();
  assistants.card = assistantCard({ chat: hasChat ? chat : null, deployments });
  return assistants;
};

describe("prompt playground (ADR-071)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const openTry = (apis: Parameters<typeof mountPage>[3], query = "?tab=try") => mountPage(PromptDetailPage, `/e/exp-1/prompts/p1${query}`, { promptId: "p1" }, apis);
  const type = async (wrapper: { find: (s: string) => { setValue: (v: string) => Promise<void> } }, id: string, value: string) => wrapper.find(`[data-testid='${id}']`).setValue(value);

  it("runs the selected version in the first non-production environment and shows the answer and the trace", async () => {
    const prompts = new FakePromptApi();
    const { wrapper } = await openTry({ prompts, assistants: agent() });
    await type(wrapper, "playground-message", "¿Lloverá mañana?");
    await wrapper.find("[data-testid='playground-run']").trigger("click");
    await flushPromises();
    expect(prompts.calls.find((c) => c.method === "runPlayground")?.args).toEqual(["exp-1", "p1", { deploymentId: "dep-dev", version: 2, message: "¿Lloverá mañana?" }]);
    const result = wrapper.find("[data-testid='playground-result-2']");
    expect(result.text()).toContain('Answer of v2 to "¿Lloverá mañana?"');
    expect(wrapper.find("[data-testid='applied-2']").text()).toBe("applied");
    expect(result.find("a").exists()).toBe(true); // link to the trace
  });

  it("never offers production", async () => {
    const { wrapper } = await openTry({ assistants: agent() });
    await chooseOption(wrapper.element, "[data-testid='playground-deployment']", "DEV · https://dev.acme.test/weather").catch(() => undefined);
    const text = wrapper.find("[data-testid='playground']").text();
    expect(text).toContain("DEV");
    expect(text).not.toContain("PRO ·");
  });

  it("runs two versions side by side, each with its own answer", async () => {
    const prompts = new FakePromptApi();
    const { wrapper } = await openTry({ prompts, assistants: agent() });
    await chooseOption(wrapper.element, "[data-testid='playground-second']", "v1 · first draft");
    await type(wrapper, "playground-message", "hola");
    expect(wrapper.find("[data-testid='playground-run']").text()).toBe("Run both");
    await wrapper.find("[data-testid='playground-run']").trigger("click");
    await flushPromises();
    const versions = prompts.calls.filter((c) => c.method === "runPlayground").map((c) => (c.args[2] as { version: number }).version).sort();
    expect(versions).toEqual([1, 2]);
    expect(wrapper.find("[data-testid='playground-result-1']").text()).toContain("Answer of v1");
    expect(wrapper.find("[data-testid='playground-result-2']").text()).toContain("Answer of v2");
  });

  it("warns, loudly, when the agent answered without applying the version", async () => {
    const prompts = new FakePromptApi();
    prompts.playground = (version, message) => ({ reply: `old answer to ${message}`, sessionId: null, traceId: null, latencyMs: 90, version, applied: false });
    const { wrapper } = await openTry({ prompts, assistants: agent() });
    await type(wrapper, "playground-message", "hola");
    await wrapper.find("[data-testid='playground-run']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='applied-2']").text()).toBe("NOT applied");
    expect(wrapper.find("[data-testid='not-applied-2']").text()).toContain("this answer is not from v2");
    expect(wrapper.find("[data-testid='not-applied-2']").text()).toContain("MEMTRACE_ALLOW_PROMPT_OVERRIDE");
  });

  it("a failing version does not hide the other one", async () => {
    const prompts = new FakePromptApi();
    prompts.playground = (version, message) => (version === 1 ? new Error("The agent did not respond: Connection refused") : { reply: `ok ${message}`, sessionId: null, traceId: null, latencyMs: 10, version, applied: true });
    const { wrapper } = await openTry({ prompts, assistants: agent() });
    await chooseOption(wrapper.element, "[data-testid='playground-second']", "v1 · first draft");
    await type(wrapper, "playground-message", "hola");
    await wrapper.find("[data-testid='playground-run']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='error-1']").text()).toContain("Connection refused");
    expect(wrapper.find("[data-testid='playground-result-2']").text()).toContain("ok hola");
  });

  it("explains why it cannot run: no chat endpoint, or only production, or credentials", async () => {
    expect((await openTry({ assistants: agent([open("dev")], false) })).wrapper.find("[data-testid='playground-unavailable']").text()).toContain("no chat endpoint");
    document.body.innerHTML = "";
    expect((await openTry({ assistants: agent([open("pro")]) })).wrapper.find("[data-testid='playground-unavailable']").text()).toContain("never runs against production");
    document.body.innerHTML = "";
    const oauth = (await openTry({ assistants: agent([deploymentDto("dev", "up")]) })).wrapper;
    expect(oauth.find("[data-testid='playground-unavailable']").text()).toContain("credentials");
    expect(oauth.find("[data-testid='playground-run']").exists()).toBe(false);
  });

  it("asks for a message before running", async () => {
    const { wrapper } = await openTry({ assistants: agent() });
    expect(wrapper.find("[data-testid='playground-run']").attributes("disabled")).toBeDefined();
  });

  it("warns that the agent must read the prompt with the SDK when none has reported it in that environment", async () => {
    const without = (await openTry({ assistants: agent() })).wrapper;
    expect(without.find("[data-testid='playground-not-reading']").text()).toContain("memtrace.prompts");
    document.body.innerHTML = "";
    const prompts = new FakePromptApi();
    prompts.detail = promptDetail({ usage: [{ experimentId: "exp-1", environment: "dev", tag: "dev", version: 2, lastSeenAt: new Date().toISOString(), active: true }] });
    const reading = (await openTry({ prompts, assistants: agent() })).wrapper;
    expect(reading.find("[data-testid='playground-not-reading']").exists()).toBe(false);
  });

  it("takes the message of a real trace, shows the original answer and keeps the link to it", async () => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ roots: [node({ content: { inputMessages: [{ role: "user", content: "¿Habrá tormenta?" }], outputMessages: [{ role: "assistant", content: "No, cielo despejado." }] } })] });
    const { wrapper } = await openTry({ assistants: agent(), traces });
    await type(wrapper, "playground-trace", "a".repeat(32));
    await wrapper.find("[data-testid='playground-load']").trigger("click");
    await flushPromises();
    expect((wrapper.find("[data-testid='playground-message']").element as HTMLTextAreaElement).value).toBe("¿Habrá tormenta?");
    expect(wrapper.find("[data-testid='playground-original']").text()).toContain("No, cielo despejado.");
  });

  it("loads the trace by itself when it arrives in the URL from the trace page", async () => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ roots: [node({ content: { inputMessages: [{ role: "user", content: "desde la traza" }], outputMessages: [{ role: "assistant", content: "vale" }] } })] });
    const { wrapper } = await openTry({ assistants: agent(), traces }, `?tab=try&trace=${"a".repeat(32)}`);
    expect((wrapper.find("[data-testid='playground-message']").element as HTMLTextAreaElement).value).toBe("desde la traza");
  });

  it("says so when the trace has no captured message", async () => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ roots: [node()] });
    const { wrapper } = await openTry({ assistants: agent(), traces });
    await type(wrapper, "playground-trace", "a".repeat(32));
    await wrapper.find("[data-testid='playground-load']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='playground-trace-problem']").text()).toContain("MEMTRACE_CAPTURE_CONTENT");
  });
});

describe("replay from the trace page (ADR-071)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const stamped = (name: string, version: string) => node({ attributes: { "memtrace.prompt.name": name, "memtrace.prompt.version": version } });
  const traceWith = (roots = [node({ children: [stamped("weather-system", "3")] })]) => {
    const traces = new FakeTraceApi();
    traces.detail = traceDetail({ roots });
    return traces;
  };
  const openTrace = (traces: FakeTraceApi, prompts = new FakePromptApi()) => mountPage(TraceDetailPage, `/e/exp-1/traces/${"a".repeat(32)}`, { traceId: "a".repeat(32) }, { traces, prompts });

  it("offers to try another version when the trace read its prompt from the registry, and opens the playground with the trace", async () => {
    const prompts = new FakePromptApi();
    prompts.list = [promptSummary("tone"), { ...promptSummary("weather-system"), id: "p-weather" }];
    const { wrapper, router } = await openTrace(traceWith(), prompts);
    const button = wrapper.find("[data-testid='replay-btn']");
    expect(button.exists()).toBe(true);
    expect(button.attributes("title")).toContain("weather-system");
    expect(button.attributes("title")).toContain("v3");
    await button.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("prompt");
    expect(router.currentRoute.value.params).toMatchObject({ experimentId: "exp-1", promptId: "p-weather" });
    expect(router.currentRoute.value.query).toMatchObject({ tab: "try", trace: "a".repeat(32) });
  });

  it("does not offer it for a trace that does not use the registry", async () => {
    const { wrapper } = await openTrace(traceWith([node()]));
    expect(wrapper.find("[data-testid='replay-btn']").exists()).toBe(false);
  });

  it("explains when the prompt is not registered for this agent", async () => {
    const { wrapper } = await openTrace(traceWith()); // the fake registry is empty
    await wrapper.find("[data-testid='replay-btn']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='replay-problem']").text()).toContain("does not belong to this agent");
  });
});
