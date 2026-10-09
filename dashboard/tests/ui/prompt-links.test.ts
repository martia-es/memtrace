import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ASSISTANT_API, CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import PromptTraces from "@/ui/components/PromptTraces.vue";
import ConversationsPage from "@/ui/pages/ConversationsPage.vue";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import PromptsPage from "@/ui/pages/PromptsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi, conversation, summary } from "../fakes";
import { FakePromptApi, promptSummary } from "../fakes-prompts";

const experiment: ExperimentDto = { id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: "technical", permissions: permissionsOf("technical"), organizationTheme: EMPTY_THEME };

async function mountAt(component: object, path: string, props: Record<string, unknown>, { trace = new FakeTraceApi(), prompts = new FakePromptApi() } = {}) {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/conversations", name: "conversations", component: stub },
      { path: "/e/:experimentId/conversations/:conversationId", name: "conversation", component: stub },
      { path: "/e/:experimentId/traces/:traceId", name: "trace", component: stub },
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
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
        [TRACE_API as symbol]: trace,
        [IDENTITY_API as symbol]: new FakeIdentityApi(),
        [PROMPT_API as symbol]: prompts,
        [ASSISTANT_API as symbol]: new FakeAssistantApi(),
        [CURRENT_EXPERIMENT as symbol]: computed(() => experiment),
      },
    },
  });
  await flushPromises();
  return { wrapper, router, trace, prompts };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const W2 = { name: "weather-system", version: 2 };

describe("prompt versions in the conversation list (ADR-068)", () => {
  it("shows which prompt version each conversation used, linking to that version", async () => {
    const trace = new FakeTraceApi();
    trace.conversationPages = [{ items: [conversation({ conversationId: "c1", prompts: [W2] })], nextCursor: null }];
    const { wrapper, router } = await mountAt(ConversationsPage, "/e/exp-1/conversations?range=24h", {}, { trace });
    const chip = wrapper.find("[data-testid='prompt-chip-weather-system-2']");
    expect(chip.text()).toContain("weather-system");
    expect(chip.text()).toContain("v2");
    expect(chip.attributes("href")).toContain("open=weather-system");
    expect(chip.attributes("href")).toContain("version=2");
    await chip.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ open: "weather-system", version: "2" });
  });

  it("filters conversations and traces by the prompt in the URL, and lets you remove the filter", async () => {
    const { wrapper, trace, router } = await mountAt(ConversationsPage, "/e/exp-1/conversations?range=24h&prompt=weather-system&pv=2", {});
    expect(trace.conversationCalls.at(-1)).toMatchObject({ promptName: "weather-system", promptVersion: 2 });
    expect(wrapper.find("[data-testid='prompt-filter']").text()).toContain("weather-system v2");
    await wrapper.find("[data-testid='prompt-filter']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.prompt).toBeUndefined();
    expect(trace.conversationCalls.at(-1)?.promptName).toBeUndefined();
  });

  it("the flat trace list has a Prompt column and sends the same filter", async () => {
    const trace = new FakeTraceApi();
    trace.pages = [{ items: [summary({ traceId: "a".repeat(32), prompts: [W2] }), summary({ traceId: "b".repeat(32), prompts: [] })], nextCursor: null }];
    const { wrapper } = await mountAt(ConversationsPage, "/e/exp-1/conversations?range=24h&group=flat&prompt=weather-system", {}, { trace });
    expect(trace.listCalls.at(-1)).toMatchObject({ promptName: "weather-system" });
    expect(wrapper.text()).toContain("Prompt");
    expect(wrapper.findAll("[data-testid^='prompt-chip-']")).toHaveLength(1); // the trace without a registry prompt shows none
  });
});

describe("opening a prompt from a link", () => {
  it("?open=name&version=N goes to that prompt's Traces tab on that version", async () => {
    const prompts = new FakePromptApi();
    prompts.list = [promptSummary("weather-system")];
    const { router } = await mountAt(PromptsPage, "/e/exp-1/prompts?open=weather-system&version=2", {}, { prompts });
    expect(router.currentRoute.value.name).toBe("prompt");
    expect(router.currentRoute.value.query).toMatchObject({ tab: "traces", version: "2" });
  });

  it("says so when the prompt is not registered for the agent, and stays on the list", async () => {
    const prompts = new FakePromptApi();
    prompts.list = [promptSummary("other")];
    const { router } = await mountAt(PromptsPage, "/e/exp-1/prompts?open=weather-system&version=2", {}, { prompts });
    expect(router.currentRoute.value.name).toBe("prompts");
  });
});

describe("all the traces of a prompt version (ADR-068)", () => {
  const withTraces = () => {
    const trace = new FakeTraceApi();
    trace.pages = [{ items: [summary({ traceId: "a".repeat(32), rootSpanName: "turno uno", prompts: [W2] }), summary({ traceId: "b".repeat(32), rootSpanName: "turno dos", prompts: [W2] })], nextCursor: null }];
    return trace;
  };

  it("lists the traces that used the selected version and asks the API for exactly that", async () => {
    const trace = withTraces();
    const { wrapper } = await mountAt(PromptTraces, "/e/exp-1/prompts/p1", { promptName: "weather-system", versions: [2, 1], selected: 2 }, { trace });
    expect(trace.listCalls.at(-1)).toMatchObject({ promptName: "weather-system", promptVersion: 2 });
    expect(wrapper.text()).toContain("turno uno");
    expect(wrapper.text()).toContain("turno dos");
    expect(wrapper.find("[data-testid='traces-count']").text()).toBe("2 traces.");
  });

  it("can show every version, and links the same search to the full list", async () => {
    const trace = withTraces();
    const { wrapper } = await mountAt(PromptTraces, "/e/exp-1/prompts/p1", { promptName: "weather-system", versions: [2, 1], selected: null }, { trace });
    expect(trace.listCalls.at(-1)?.promptVersion).toBeUndefined();
    const href = wrapper.find("[data-testid='traces-open-all']").attributes("href")!;
    expect(href).toContain("group=flat");
    expect(href).toContain("prompt=weather-system");
    expect(href).not.toContain("pv=");
  });

  it("explains how traces get here when there are none", async () => {
    const { wrapper } = await mountAt(PromptTraces, "/e/exp-1/prompts/p1", { promptName: "weather-system", versions: [1], selected: 1 });
    expect(wrapper.find("[data-testid='traces-empty']").text()).toContain("compile()");
  });

  it("is a tab of the prompt, and opens on the version in the link", async () => {
    const trace = withTraces();
    const { wrapper } = await mountAt(PromptDetailPage, "/e/exp-1/prompts/p1?tab=traces&version=2", { promptId: "p1" }, { trace });
    expect(wrapper.find("[data-testid='pane-traces']").exists()).toBe(true);
    expect(trace.listCalls.at(-1)).toMatchObject({ promptName: "weather-system", promptVersion: 2 });
  });
});
