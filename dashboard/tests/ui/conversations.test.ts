import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { TRACE_API } from "@/dependency-container";
import ConversationDetailPage from "@/ui/pages/ConversationDetailPage.vue";
import ConversationsPage from "@/ui/pages/ConversationsPage.vue";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import TracesPage from "@/ui/pages/TracesPage.vue";
import { FakeTraceApi, conversation, node, summary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["traces", "trace", "conversations", "conversation"].map((name) => ({
      name,
      path: `/${name === "trace" ? "traces/:traceId" : name === "conversation" ? "conversations/:conversationId" : name}`,
      component: { template: "<div />" },
    })),
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, { global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api } } });
  await flushPromises();
  return { wrapper, router };
}

describe("ConversationsPage", () => {
  it("lists conversations, sends the filters and loads the next page", async () => {
    const api = new FakeTraceApi();
    api.conversationPages = [
      { items: [conversation({ conversationId: "primera", turnCount: 3, errorTurns: 1 })], nextCursor: "1" },
      { items: [conversation({ conversationId: "segunda", failedSpans: 2 })], nextCursor: null },
    ];
    const { wrapper } = await setup(ConversationsPage, api, "/conversations?range=6h&service=svc-a&hasErrors=1");
    expect(api.conversationCalls[0]).toMatchObject({ service: "svc-a", hasErrors: true });
    expect(Date.parse(api.conversationCalls[0]!.to) - Date.parse(api.conversationCalls[0]!.from)).toBe(6 * 3600_000);
    expect(wrapper.text()).toContain("primera");
    expect(wrapper.text()).toContain("1 turno fallido");

    await wrapper.findAll("button").find((b) => b.text().includes("Cargar más"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("segunda");
    expect(wrapper.text()).toContain("2 spans fallidos");
    expect(api.conversationCalls.at(-1)?.cursor).toBe("1");
  });

  it("explains how to create conversations when there are none", async () => {
    const { wrapper } = await setup(ConversationsPage, new FakeTraceApi(), "/conversations");
    expect(wrapper.text()).toContain("gen_ai.conversation.id");
    expect(wrapper.text()).toContain("memtrace.session");
  });

  it("opens the conversation keeping the shared filters", async () => {
    const api = new FakeTraceApi();
    api.conversationPages = [{ items: [conversation({ conversationId: "abc def" })], nextCursor: null }];
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?range=24h&service=svc-a");
    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
    expect(router.currentRoute.value.params.conversationId).toBe("abc def");
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });
});

describe("ConversationDetailPage", () => {
  const detail = () => ({
    ...conversation({ conversationId: "conv-1", turnCount: 2, errorTurns: 1, totalTokens: 300 }),
    turns: {
      items: [
        summary({ traceId: "1".repeat(32), rootSpanName: "primer turno", startTime: "2026-09-26T12:00:00.000Z", durationMs: 2000 }),
        summary({ traceId: "2".repeat(32), rootSpanName: "segundo turno", startTime: "2026-09-26T12:01:02.000Z", durationMs: 500, status: "error", errorCount: 1 }),
      ],
      nextCursor: null,
    },
  });

  it("shows the aggregates, the turns in order and the wait between them", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    const { wrapper } = await setup(ConversationDetailPage, api, "/conversations/conv-1", { conversationId: "conv-1" });
    const text = wrapper.text();
    expect(text).toContain("2 turnos");
    expect(text).toContain("1 turno fallido");
    expect(text).toContain("300 tokens");
    expect(text.indexOf("Turno 1 · primer turno")).toBeLessThan(text.indexOf("Turno 2 · segundo turno"));
    expect(text).toContain("1 min 0 s después del turno anterior"); // 12:00:02 -> 12:01:02
    expect(api.conversationDetailCalls[0]).toMatchObject({ id: "conv-1" });
  });

  it("opens a turn's trace", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    const { wrapper, router } = await setup(ConversationDetailPage, api, "/conversations/conv-1", { conversationId: "conv-1" });
    await wrapper.find(".turn-card").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe("1".repeat(32));
  });

  it("explains an unknown conversation", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = new ApiError(404, "Not Found", "Conversation x not found");
    const { wrapper } = await setup(ConversationDetailPage, api, "/conversations/x", { conversationId: "x" });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
});

describe("links between traces and conversations", () => {
  it("filters the trace list by conversation and shows a removable chip", async () => {
    const api = new FakeTraceApi();
    const { wrapper, router } = await setup(TracesPage, api, "/traces?conversation=conv-9");
    expect(api.listCalls[0]).toMatchObject({ conversationId: "conv-9" });
    expect(wrapper.text()).toContain("Conversación: conv-9");
    await wrapper.find(".q-chip__icon--remove").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.conversation).toBeUndefined();
  });

  it("links a trace row to its conversation", async () => {
    const api = new FakeTraceApi();
    api.pages = [{ items: [summary({ conversationId: "conv-7" })], nextCursor: null }];
    const { wrapper } = await setup(TracesPage, api, "/traces");
    expect(wrapper.find("a.conv-link").text()).toContain("conv-7");
  });

  it("links the trace detail to its conversation", async () => {
    const api = new FakeTraceApi();
    api.detail = {
      traceId: "b".repeat(32), conversationId: "conv-3", startTime: new Date().toISOString(), durationMs: 5, status: "ok",
      spanCount: 1, errorCount: 0, totalTokens: 0, truncated: false, roots: [node({ spanId: "r" })],
    };
    const { wrapper, router } = await setup(TraceDetailPage, api, `/traces/${"b".repeat(32)}`, { traceId: "b".repeat(32) });
    const chip = wrapper.findAll(".q-chip").find((c) => c.text().includes("Conversación: conv-3"))!;
    await chip.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
    expect(router.currentRoute.value.params.conversationId).toBe("conv-3");
  });
});

describe("Conversation transcript", () => {
  const detail = () => ({
    ...conversation({ conversationId: "conv-1" }),
    turns: { items: [summary({ traceId: "1".repeat(32), rootSpanName: "turno" })], nextCursor: null },
  });
  const transcript = (over = {}) => ({
    conversationId: "conv-1", contentCaptured: true, truncated: false,
    turns: [{ traceId: "1".repeat(32), startTime: "2026-09-26T12:00:00.000Z", model: "gpt-4o", user: "¿Dónde está mi pedido?", assistant: "Está en camino" }],
    ...over,
  });

  it("does not fetch the transcript until its tab is opened", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    api.transcript = transcript();
    const { wrapper, router } = await setup(ConversationDetailPage, api, "/conversations/conv-1", { conversationId: "conv-1" });
    expect(api.transcriptCalls).toBe(0);

    await wrapper.findAll('[role="tab"]').find((t) => t.text().includes("Transcripción"))!.trigger("click");
    await flushPromises();
    expect(api.transcriptCalls).toBe(1);
    expect(router.currentRoute.value.query.tab).toBe("transcript");
  });

  it("renders the user and assistant messages as chat bubbles, with a link to the trace", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    api.transcript = transcript();
    const { wrapper, router } = await setup(ConversationDetailPage, api, "/conversations/conv-1?tab=transcript", { conversationId: "conv-1" });
    expect(wrapper.find('[data-role="user"]').text()).toBe("¿Dónde está mi pedido?");
    expect(wrapper.find('[data-role="assistant"]').text()).toContain("Está en camino");
    expect(wrapper.find('[data-role="assistant"]').text()).toContain("gpt-4o");

    await wrapper.findAll("button").find((b) => b.text().includes("Ver traza"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.traceId).toBe("1".repeat(32));
  });

  it("explains how to enable content capture when nothing was stored", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    api.transcript = transcript({ contentCaptured: false, turns: [] });
    const { wrapper } = await setup(ConversationDetailPage, api, "/conversations/conv-1?tab=transcript", { conversationId: "conv-1" });
    expect(wrapper.text()).toContain("MEMTRACE_CAPTURE_CONTENT=true");
    expect(wrapper.find('[data-role="user"]').exists()).toBe(false);
  });

  it("shows an error banner if the transcript fails", async () => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    api.transcript = new ApiError(503, "Service Unavailable");
    const { wrapper } = await setup(ConversationDetailPage, api, "/conversations/conv-1?tab=transcript", { conversationId: "conv-1" });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
});
