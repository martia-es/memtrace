import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import ErrorBanner from "@/ui/components/ErrorBanner.vue";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import ConversationsPage from "@/ui/pages/ConversationsPage.vue";
import { FakeIdentityApi, FakeTraceApi, conversation, node, summary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
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
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } },
  });
  await flushPromises();
  return { wrapper, router };
}

const overview = () => ({
  range: { from: "", to: "", bucketSeconds: 60 },
  totals: { traces: 10, spans: 124318, conversations: 5906, errorTraces: 2, errorRate: 0.021, inputTokens: 1, outputTokens: 1, totalTokens: 5204 },
  latencyMs: { p50: 100, p95: 4800, p99: 9000 },
  timeseries: [],
  byModel: [{ model: "sonnet-4-5", calls: 3, inputTokens: 1, outputTokens: 1, p95Ms: 10 }],
  byTool: [],
  byTopic: [],
});

describe("ConversationsPage", () => {
  it("lists all traces by default (grouping off), loads the next page and links to the conversation", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.pages = [
      { items: [summary({ traceId: "1".repeat(32), rootSpanName: "primera", errorCount: 2, conversationId: "conv-7" })], nextCursor: "1" },
      { items: [summary({ traceId: "2".repeat(32), rootSpanName: "segunda" })], nextCursor: null },
    ];
    const { wrapper } = await setup(ConversationsPage, api, "/conversations?range=6h&service=svc-a");
    expect(api.conversationCalls).toHaveLength(0);
    expect(api.listCalls[0]).toMatchObject({ service: "svc-a" });
    expect(Date.parse(api.listCalls[0]!.to) - Date.parse(api.listCalls[0]!.from)).toBe(6 * 3600_000);
    expect(wrapper.text()).toContain("primera");
    expect(wrapper.text()).toContain("conv-7");
    expect(wrapper.text()).not.toContain("segunda");
    expect(wrapper.text()).toContain("5906");
    expect(wrapper.find(".group-toggle").attributes("aria-checked")).toBe("false");

    await wrapper.findAll("button").find((b) => b.text().includes("Load more"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("segunda");
    expect(api.listCalls.at(-1)?.cursor).toBe("1");
  });

  it("opens a trace directly, keeping the shared filters", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.pages = [{ items: [summary({ traceId: "c".repeat(32) })], nextCursor: null }];
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?range=24h&service=svc-a");
    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe("c".repeat(32));
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });

  it("groups by conversation when the URL asks for it and opens the conversation", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.conversationPages = [{ items: [conversation({ conversationId: "abc def", turnCount: 3, errorTurns: 1 })], nextCursor: null }];
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations?range=24h&service=svc-a&group=conversation");
    expect(api.listCalls).toHaveLength(0);
    expect(wrapper.text()).toContain("abc def");
    expect(wrapper.text()).toContain("Error");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversation");
    expect(router.currentRoute.value.params.conversationId).toBe("abc def");
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });

  it("switches to the grouped list with the toggle, storing the choice in the URL", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper, router } = await setup(ConversationsPage, api, "/conversations");
    await wrapper.find(".group-toggle").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.group).toBe("conversation");
    expect(api.conversationCalls).toHaveLength(1);
  });

  it("explains an empty result", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper } = await setup(ConversationsPage, api, "/conversations");
    expect(wrapper.text()).toContain("No traces detected yet");
  });

  it("shows an actionable message when the API is unreachable", async () => {
    const api = new FakeTraceApi();
    api.listTraces = async () => {
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
    return { traceId: T, conversationId: "conv-3" as string | null, startTime: "2026-09-26T12:00:00.000Z", durationMs: 50, status: "ok" as const, spanCount: 3, errorCount: 1, totalTokens: 0, truncated: false, framework: null, roots: [root] };
  };
  const open = (path = `/traces/${T}`, tweak: (api: FakeTraceApi) => void = () => {}) => {
    const api = new FakeTraceApi();
    api.detail = detail();
    tweak(api);
    return setup(TraceDetailPage, api, path, { traceId: T }).then((r) => ({ api, ...r }));
  };

  it("shows the span tree on the left and selects the first failed span, with input and output", async () => {
    const { wrapper } = await open();
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(3);
    expect(wrapper.find('[aria-selected="true"]').text()).toContain("tool.add_baggage");
    const inspector = wrapper.find(".inspector").text();
    expect(inspector).toContain("Input");
    expect(inspector).toContain("bags"); // argumentos de la herramienta
    expect(inspector).toContain("TimeoutError: 30000 ms"); // el error encabeza la salida
  });

  it("selects a span from the URL or by clicking, showing an LLM's messages and metadata", async () => {
    const { wrapper, router } = await open(`/traces/${T}?span=c1`);
    expect(wrapper.find('[aria-selected="true"]').text()).toContain("llm.reason");
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
