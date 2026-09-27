import { flushPromises, mount, type DOMWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import ConversationDetailPage from "@/ui/pages/ConversationDetailPage.vue";
import { FakeIdentityApi, FakeTraceApi, conversation, node, summary, traceDetail } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["conversations", "trace", "conversation"].map((name) => ({
      name,
      path: `/${name === "trace" ? "traces/:traceId" : name === "conversation" ? "conversations/:conversationId" : "conversations"}`,
      component: { template: "<div />" },
    })),
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, { global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } } });
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
});
const buttonWith = (wrapper: { findAll: (s: string) => DOMWrapper<Element>[] }, text: string) =>
  wrapper.findAll("button").find((b) => b.text().includes(text))!;

describe("ConversationDetailPage", () => {
  const T1 = "1".repeat(32);
  const T2 = "2".repeat(32);
  const detail = () => ({
    ...conversation({ conversationId: "conv-1", turnCount: 2, errorTurns: 1, totalTokens: 300, failedSpans: 1 }),
    turns: {
      items: [
        summary({ traceId: T1, rootSpanName: "primer turno", startTime: "2026-09-26T12:00:00.000Z", durationMs: 2000 }),
        summary({ traceId: T2, rootSpanName: "segundo turno", startTime: "2026-09-26T12:01:02.000Z", durationMs: 500, status: "error", errorCount: 1 }),
      ],
      nextCursor: null,
    },
  });
  const transcript = (over = {}) => ({
    conversationId: "conv-1", contentCaptured: true, truncated: false,
    turns: [{ traceId: T1, startTime: "2026-09-26T12:00:00.000Z", model: "m", user: "Reserva mi vuelo a Lisboa", assistant: "Hecho" }],
    ...over,
  });
  const open = async (path = "/conversations/conv-1", tweak: (api: FakeTraceApi) => void = () => {}) => {
    const api = new FakeTraceApi();
    api.conversationDetail = detail();
    api.transcript = transcript();
    tweak(api);
    return { api, ...(await setup(ConversationDetailPage, api, path, { conversationId: "conv-1" })) };
  };

  it("shows the header aggregates and the turns in order, using the user's message as the label", async () => {
    const { wrapper, api } = await open();
    const text = wrapper.text();
    expect(text).toContain("1 traza con error");
    expect(text).toContain("300");
    expect(text.indexOf("Reserva mi vuelo a Lisboa")).toBeLessThan(text.indexOf("segundo turno")); // T1 usa la transcripción; T2 cae al span raíz
    expect(api.conversationDetailCalls[0]).toMatchObject({ id: "conv-1" });
  });

  it("opens a trace from its row, keeping the shared filters", async () => {
    const { wrapper, router } = await open("/conversations/conv-1?range=6h&service=svc-a");
    await wrapper.findAll("tbody tr")[1]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe(T2);
    expect(router.currentRoute.value.query).toMatchObject({ range: "6h", service: "svc-a" });
  });

  it("goes back to the grouped list keeping the shared filters", async () => {
    const { wrapper, router } = await open("/conversations/conv-1?range=6h&service=svc-a");
    await wrapper.find(".crumb").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("conversations");
    expect(router.currentRoute.value.query).toMatchObject({ range: "6h", service: "svc-a", group: "conversation" });
  });

  it("switches to the tree view, stacking each turn's span tree, and lets you inspect a span", async () => {
    const { wrapper, api } = await open("/conversations/conv-1", (api) => {
      api.conversationTree = {
        items: [
          traceDetail({ traceId: T1, roots: [node({ spanId: "s1", name: "root-1" })] }),
          traceDetail({ traceId: T2, roots: [node({ spanId: "s2", name: "root-2" })], status: "error", errorCount: 1 }),
        ],
        nextCursor: null,
      };
    });

    await buttonWith(wrapper, "Tree").trigger("click");
    await flushPromises();
    expect(api.conversationTreeCalls[0]).toMatchObject({ id: "conv-1" });
    expect(wrapper.text()).toContain("root-1");
    expect(wrapper.text()).toContain("root-2");

    await wrapper.find(".row").trigger("click"); // primer span del primer turno
    await flushPromises();
    expect(wrapper.find(".empty-card").exists()).toBe(false);
  });

  it("explains an unknown conversation", async () => {
    const { wrapper } = await open("/conversations/x", (api) => (api.conversationDetail = new ApiError(404, "Not Found", "Conversation x not found")));
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
});
