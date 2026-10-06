import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import ErrorBanner from "@/ui/components/ErrorBanner.vue";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import ConversationsPage from "@/ui/pages/ConversationsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi, conversation, node, summary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}, role = "technical") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/overview", name: "overview", component: { template: "<div />" } },
      { path: "/conversations", name: "conversations", component: { template: "<div />" } },
      { path: "/traces/:traceId", name: "trace", component: { template: "<div />" } },
      { path: "/conversations/:conversationId", name: "conversation", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  // QPage solo funciona dentro de un layout, igual que en la app
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi(), [CURRENT_EXPERIMENT as symbol]: { value: { myRole: role, permissions: permissionsOf(role) } } } },
  });
  await flushPromises();
  return { wrapper, router };
}

const overview = () => ({
  range: { from: "", to: "", bucketSeconds: 60 },
  totals: { traces: 10, spans: 124318, conversations: 5906, errorTraces: 2, errorRate: 0.021, inputTokens: 1, outputTokens: 1, totalTokens: 5204, costUsd: 0 },
  latencyMs: { p50: 100, p95: 4800, p99: 9000 },
  timeseries: [],
  byModel: [{ model: "sonnet-4-5", calls: 3, inputTokens: 1, outputTokens: 1, p95Ms: 10, costUsd: null }],
  byTool: [],
  byTopic: [],
});

describe("ConversationsPage", () => {
  it("lists conversations by default and offers traces as the second view", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.conversationPages = [{ items: [conversation({ conversationId: "conv-1", turnCount: 3 })], nextCursor: null }];
    const { wrapper } = await setup(ConversationsPage, api, "/conversations?range=6h&service=svc-a");
    expect(api.listCalls).toHaveLength(0);
    expect(api.conversationCalls[0]).toMatchObject({ service: "svc-a" });
    expect(wrapper.text()).toContain("conv-1");
    expect(wrapper.find(".mode-conversations").attributes("aria-pressed")).toBe("true");
    expect(wrapper.find(".mode-traces").attributes("aria-pressed")).toBe("false");
  });

  it("sends the search text from the URL to both list modes", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    await setup(ConversationsPage, api, "/conversations?q=refund");
    expect(api.conversationCalls[0]).toMatchObject({ text: "refund" });
    const flat = new FakeTraceApi();
    flat.overview = overview();
    await setup(ConversationsPage, flat, "/conversations?q=refund&group=flat");
    expect(flat.listCalls[0]).toMatchObject({ text: "refund" });
  });

  it("lists all traces in the traces view, loads the next page and links to the conversation", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.pages = [
      { items: [summary({ traceId: "1".repeat(32), rootSpanName: "primera", errorCount: 2, conversationId: "conv-7" })], nextCursor: "1" },
      { items: [summary({ traceId: "2".repeat(32), rootSpanName: "segunda" })], nextCursor: null },
    ];
    const { wrapper } = await setup(ConversationsPage, api, "/conversations?range=6h&service=svc-a&group=flat");
    expect(api.conversationCalls).toHaveLength(0);
    expect(api.listCalls[0]).toMatchObject({ service: "svc-a" });
    expect(Date.parse(api.listCalls[0]!.to) - Date.parse(api.listCalls[0]!.from)).toBe(6 * 3600_000);
    expect(wrapper.text()).toContain("primera");
    expect(wrapper.text()).toContain("conv-7");
    expect(wrapper.text()).not.toContain("segunda");
    expect(wrapper.text()).toContain("5,906");

    await wrapper.findAll("button").find((b) => b.text().includes("Load more"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("segunda");
    expect(api.listCalls.at(-1)?.cursor).toBe("1");
  });

  it("previews a trace on click and opens it on double click, keeping the shared filters", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.pages = [{ items: [summary({ traceId: "c".repeat(32), rootSpanName: "reserva", input: "Reserva mi vuelo", output: "Hecho" })], nextCursor: null }];
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?range=24h&service=svc-a&group=flat");
    expect(wrapper.find('[data-testid="preview-open"]').exists()).toBe(false);

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversations");
    expect(wrapper.find('[data-testid="preview-open"]').exists()).toBe(true);
    expect(wrapper.find("aside").text()).toContain("Reserva mi vuelo");
    expect(wrapper.find("aside").text()).toContain("Hecho");

    await wrapper.find("tbody tr").trigger("dblclick");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe("c".repeat(32));
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });

  it("previews a conversation with its transcript and opens it from the preview", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.conversationPages = [{ items: [conversation({ conversationId: "abc def", turnCount: 3, errorTurns: 1 })], nextCursor: null }];
    api.transcript = { conversationId: "abc def", contentCaptured: true, truncated: false, turns: [{ traceId: "t".repeat(32), startTime: "2026-09-26T12:00:00.000Z", model: "m", user: "Hola", assistant: "Buenas" }] };
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?range=24h&service=svc-a");
    expect(wrapper.text()).toContain("abc def");
    expect(wrapper.text()).toContain("Error");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(wrapper.find("aside").text()).toContain("Hola");
    expect(wrapper.find("aside").text()).toContain("Buenas");

    await wrapper.find('[data-testid="preview-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
    expect(router.currentRoute.value.params.conversationId).toBe("abc def");
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });

  it("titles each conversation with the user's first message and shows its cost", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.conversationPages = [{ items: [conversation({ conversationId: "conv-1", title: "Do I need an umbrella in Bilbao?", costUsd: 0.0123 }), conversation({ conversationId: "conv-2" })], nextCursor: null }];
    api.transcript = { conversationId: "conv-1", contentCaptured: true, truncated: false, turns: [] };
    const { wrapper } = await setup(ConversationsPage, api, "/conversations");
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0]!.text()).toContain("Do I need an umbrella in Bilbao?");
    expect(rows[0]!.text()).toContain("conv-1"); // the id stays visible under the title
    expect(rows[0]!.text()).toContain("$0.01");
    expect(rows[1]!.text()).toContain("conv-2"); // no content captured: the id is the name
    expect(rows[1]!.text()).toContain("–");

    await rows[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("aside").text()).toContain("Do I need an umbrella in Bilbao?");
  });

  it("closes the preview and opens the conversation straight from a double click", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.conversationPages = [{ items: [conversation({ conversationId: "conv-9" })], nextCursor: null }];
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations");
    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="preview-close"]').trigger("click");
    expect(wrapper.find("aside").exists()).toBe(false);

    await wrapper.find("tbody tr").trigger("dblclick");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
  });

  it("switches to traces with the view selector, storing the choice in the URL", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations");
    expect(api.conversationCalls).toHaveLength(1);
    await wrapper.find(".mode-traces").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.group).toBe("flat");
    expect(api.listCalls).toHaveLength(1);
  });

  it("applies the quick views (errors and slow) as filters in the URL", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?group=flat");
    const tab = (label: string) => wrapper.findAll('[role="tab"]').find((t) => t.text().includes(label))!;
    expect(tab("All").attributes("aria-selected")).toBe("true");

    await tab("With errors").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.hasErrors).toBe("1");
    expect(api.listCalls.at(-1)).toMatchObject({ hasErrors: true });

    await tab("Slow").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.hasErrors).toBeUndefined();
    expect(router.currentRoute.value.query.min).toBe("5000");
    expect(api.listCalls.at(-1)).toMatchObject({ minDurationMs: 5000 });
  });

  it("explains an empty result", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper } = await setup(ConversationsPage, api, "/conversations");
    expect(wrapper.text()).toContain("No traces detected yet");
  });

  it("shows an actionable message when the API is unreachable", async () => {
    const api = new FakeTraceApi();
    api.listConversations = async () => {
      throw new ApiError(0, "Sin conexión");
    };
    const { wrapper } = await setup(ConversationsPage, api, "/conversations");
    expect(wrapper.find('[role="alert"]').text()).toContain("Could not reach the API");
  });
});

describe("TraceDetailPage", () => {
  const T = "b".repeat(32);
  const detail = () => {
    const llm = node({
      spanId: "c1", parentSpanId: "r", name: "llm.reason", kind: "llm", offsetMs: 5, durationMs: 20,
      genAi: { operation: "chat", provider: "anthropic", requestModel: "sonnet-4-5", responseModel: null, inputTokens: 10, outputTokens: 5, totalTokens: 15, finishReasons: [], temperature: null, maxTokens: null, toolName: null, toolCallId: null },
      content: { inputMessages: [{ role: "user", content: "Reserva mi vuelo" }], outputMessages: [{ role: "assistant", content: "Hecho" }] },
      attributes: { "gen_ai.system": "anthropic" },
    });
    const tool = node({ spanId: "c2", parentSpanId: "r", name: "tool.add_baggage", kind: "tool", offsetMs: 30, durationMs: 15, status: { code: "error", message: "TimeoutError: 30000 ms" }, content: { toolArguments: { bags: 1 } }, events: [{ name: "exception", time: "2026-09-26T12:00:00.040Z", attributes: { "exception.message": "boom" } }] });
    const root = node({ spanId: "r", name: "raiz", kind: "agent", durationMs: 50, children: [llm, tool] });
    return { traceId: T, conversationId: "conv-3" as string | null, startTime: "2026-09-26T12:00:00.000Z", durationMs: 50, status: "ok" as const, spanCount: 3, errorCount: 1, totalTokens: 0, totalCostUsd: 0, truncated: false, framework: null, roots: [root] };
  };
  const open = (path = `/traces/${T}`, tweak: (api: FakeTraceApi) => void = () => {}, role = "technical") => {
    const api = new FakeTraceApi();
    api.detail = detail();
    tweak(api);
    return setup(TraceDetailPage, api, path, { traceId: T }, role).then((r) => ({ api, ...r }));
  };

  it("shows a business profile only the conversation, never the technical trace (ADR-052)", async () => {
    const { wrapper } = await open(`/traces/${T}`, () => {}, "business");
    expect(wrapper.find('[data-testid="tab-trace"]').exists()).toBe(false);
    expect(wrapper.find('[role="treeitem"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="thread"]').text()).toContain("Reserva mi vuelo");
  });

  it("shows the span tree on the left and selects the first failed span, with input and output", async () => {
    const { wrapper } = await open();
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(3);
    expect(wrapper.find('[role="treeitem"][aria-selected="true"]').text()).toContain("tool.add_baggage");
    const inspector = wrapper.find(".inspector").text();
    expect(inspector).toContain("Input");
    expect(inspector).toContain("bags"); // argumentos de la herramienta
    expect(inspector).toContain("TimeoutError: 30000 ms"); // el error encabeza la salida
  });

  it("reads the conversation like a chat on its own tab, keeping the technical trace as the default", async () => {
    const { wrapper, router } = await open();
    expect(wrapper.find('[data-testid="thread"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="tab-trace"]').attributes("aria-selected")).toBe("true");

    await wrapper.get('[data-testid="tab-conversation"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("conversation");
    const thread = wrapper.get('[data-testid="thread"]');
    expect(thread.text()).toContain("Reserva mi vuelo");
    expect(thread.text()).toContain("Hecho");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(0);

    await wrapper.get('[data-testid="tab-trace"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(3);
  });

  it("opens the annotation panel (ADR-037) from the Annotate button, scoped to the selected span", async () => {
    const { wrapper } = await open(`/traces/${T}?span=c1`);
    expect(document.body.querySelector('[data-testid="annotations-panel"]')).toBeNull();
    await wrapper.get('[data-testid="annotate-btn"]').trigger("click");
    await flushPromises();
    const panel = document.body.querySelector('[data-testid="annotations-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("llm.reason"); // the span selected in the tree is offered as the annotation target
  });

  it("selects a span from the URL or by clicking, showing an LLM's messages and metadata", async () => {
    const { wrapper, router } = await open(`/traces/${T}?span=c1`);
    expect(wrapper.find('[role="treeitem"][aria-selected="true"]').text()).toContain("llm.reason");
    expect(wrapper.find(".inspector").text()).toContain("Reserva mi vuelo");
    expect(wrapper.find(".inspector").text()).toContain("Hecho");
    expect(wrapper.find(".inspector").text()).toContain("sonnet-4-5");

    await wrapper.findAll('[role="treeitem"]').find((r) => r.text().includes("tool.add_baggage"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.span).toBe("c2");

    await wrapper.findAll(".inspector button").find((b) => b.text().includes("Events"))!.trigger("click");
    expect(wrapper.find(".inspector").text()).toContain("exception.message=boom");
  });

  it("renders LangChain metadata and tags in the metadata tab", async () => {
    const apiDetail = detail();
    const child = apiDetail.roots[0]?.children?.[0];
    if (child) {
      child.attributes = {
        ...child.attributes,
        "memtrace.metadata": JSON.stringify({ thread_id: "conv-42", custom: { foo: "bar" } }),
        "memtrace.tags": JSON.stringify(["debug", "prod"]),
      };
    }

    const { wrapper } = await open(`/traces/${T}?span=c1`, (api) => {
      api.detail = apiDetail;
    });

    await wrapper.findAll(".inspector button").find((b) => b.text().includes("Metadata"))!.trigger("click");
    const text = wrapper.find(".inspector").text();
    expect(text).toContain("thread_id");
    expect(text).toContain("conv-42");
    expect(text).toContain("debug");
    expect(text).toContain("prod");
  });

  it("explains how to capture content when the span has none", async () => {
    const { wrapper } = await open(`/traces/${T}?span=r`);
    expect(wrapper.find(".inspector").text()).toContain("MEMTRACE_CAPTURE_CONTENT=true");
  });

  it("has breadcrumbs back to the list and to the conversation, keeping the shared filters", async () => {
    const { wrapper, router } = await open(`/traces/${T}?range=6h&service=svc-a`);
    const crumbs = wrapper.findAll(".crumb");
    await crumbs[1]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
    expect(router.currentRoute.value.params.conversationId).toBe("conv-3");
    expect(router.currentRoute.value.query).toMatchObject({ range: "6h", service: "svc-a" });

    const again = await open(`/traces/${T}?range=6h`);
    await again.wrapper.findAll(".crumb")[0]!.trigger("click");
    await flushPromises();
    expect(again.router.currentRoute.value.name).toBe("conversations");
  });

  it("omits the conversation crumb for a trace without conversation", async () => {
    const { wrapper } = await open(`/traces/${T}`, (api) => (api.detail = { ...detail(), conversationId: null }));
    expect(wrapper.findAll(".crumb")).toHaveLength(1);
  });

  it("warns about orphan spans and truncated traces", async () => {
    const { wrapper } = await open(`/traces/${T}`, (api) => (api.detail = { ...detail(), truncated: true, roots: [node({ spanId: "o", name: "huerfano", orphan: true })] }));
    expect(wrapper.text()).toContain("more than 5000 spans");
    expect(wrapper.text()).toContain("have no parent");
  });

  it("explains a missing trace", async () => {
    const wrapper = mount(ErrorBanner, { props: { error: new ApiError(404, "Not Found") }, global: { plugins: [[Quasar, {}]] } });
    expect(wrapper.text()).toContain("retention");
  });
});
