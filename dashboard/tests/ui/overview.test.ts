import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import MetricsPage from "@/ui/pages/MetricsPage.vue";
import AnnotationQueuesPage from "@/ui/pages/AnnotationQueuesPage.vue";
import { FakeIdentityApi, FakeTraceApi, queueSummary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/overview", name: "overview", component: { template: "<div />" } },
      { path: "/conversations", name: "conversations", component: { template: "<div />" } },
      { path: "/traces/:traceId", name: "trace", component: { template: "<div />" } },
      { path: "/annotation-queues", name: "annotation-queues", component: { template: "<div />" } },
      { path: "/annotation-queues/:queueId/review", name: "annotation-queue-review", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component))) });
  const wrapper = mount(Host, {
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } },
  });
  await flushPromises();
  return { wrapper, router };
}

// ECharts needs a real canvas, which jsdom does not have: the charts are not what these tests are about
vi.mock("@/ui/components/EChart.vue", () => ({ default: { name: "EChart", template: "<div class=\"echart-stub\" />" } }));

const overview = (over: { errorTraces?: number; errorRate?: number; byTool?: { tool: string; calls: number; errors: number; p95Ms: number }[] } = {}) => ({
  range: { from: "", to: "", bucketSeconds: 60 },
  totals: { traces: 100, spans: 900, conversations: 40, errorTraces: over.errorTraces ?? 0, errorRate: over.errorRate ?? 0, inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 1.5 },
  latencyMs: { p50: 100, p95: 4800, p99: 9000 },
  timeseries: [],
  byModel: [{ model: "sonnet-4-5", calls: 3, inputTokens: 1, outputTokens: 1, p95Ms: 10, costUsd: 1 }],
  byTool: over.byTool ?? [],
  byTopic: [],
});

describe("Overview (MetricsPage)", () => {
  it("says the assistant is healthy and has nothing to flag when there are no errors", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper } = await setup(MetricsPage, api, "/overview");
    expect(wrapper.get('[data-testid="health-banner"]').text()).toContain("Your assistant is healthy");
    expect(wrapper.get('[data-testid="health-banner"]').classes()).toContain("ok");
    expect(wrapper.find('[data-testid="all-clear"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="attention-item"]')).toHaveLength(0);
  });

  it("lists what needs attention (errors, failing tools, pending reviews), each with a direct action", async () => {
    const api = new FakeTraceApi();
    api.overview = overview({
      errorTraces: 8,
      errorRate: 0.08,
      byTool: [
        { tool: "get_coordinates", calls: 100, errors: 10, p95Ms: 300 },
        { tool: "get_forecast", calls: 100, errors: 0, p95Ms: 300 },
      ],
    });
    api.queues = [queueSummary({ progress: { pending: 5, completed: 1, skipped: 0 } }), queueSummary({ id: "q-2", progress: { pending: 3, completed: 0, skipped: 0 } })];
    const { wrapper, router } = await setup(MetricsPage, api, "/overview");

    expect(wrapper.get('[data-testid="health-banner"]').text()).toContain("Your assistant needs attention");
    const items = wrapper.findAll('[data-testid="attention-item"]');
    expect(items.map((i) => i.text())).toEqual([
      expect.stringContaining("8 executions ended with errors"),
      expect.stringContaining("get_coordinates fails"), // only the tool that actually fails
      expect.stringContaining("8 items are waiting for review"),
    ]);

    await items[2]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("annotation-queues");
  });
});

describe("Overview low-rated traces (ADR-049)", () => {
  it("flags traces that reviewers rated low and opens the latest one", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    api.lowRated = { count: 3, items: [{ traceId: "t".repeat(32), configName: "Helpfulness", value: "1", createdAt: "2026-10-04T10:00:00.000Z" }] };
    const { wrapper, router } = await setup(MetricsPage, api, "/overview");

    const item = wrapper.findAll('[data-testid="attention-item"]').find((i) => i.text().includes("rated low"))!;
    expect(item.text()).toContain("3 traces were rated low by reviewers");
    expect(item.text()).toContain("Helpfulness = 1");

    await item.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe("t".repeat(32));
  });

  it("does not mention ratings when nobody rated anything low", async () => {
    const api = new FakeTraceApi();
    api.overview = overview();
    const { wrapper } = await setup(MetricsPage, api, "/overview");
    expect(wrapper.text()).not.toContain("rated low");
  });
});

describe("AnnotationQueuesPage inbox", () => {
  it("greets the reviewer with what is waiting and jumps into the first queue with pending work", async () => {
    const api = new FakeTraceApi();
    api.queues = [
      queueSummary({ id: "q-done", name: "Done", progress: { pending: 0, completed: 4, skipped: 0 } }),
      queueSummary({ id: "q-work", name: "Support QA", progress: { pending: 6, completed: 2, skipped: 0 } }),
    ];
    const { wrapper, router } = await setup(AnnotationQueuesPage, api, "/annotation-queues");
    expect(wrapper.get('[data-testid="inbox"]').text()).toContain("6 items are waiting for review");

    await wrapper.get('[data-testid="continue-reviewing"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("annotation-queue-review");
    expect(router.currentRoute.value.params.queueId).toBe("q-work");
  });

  it("shows no inbox banner when everything is reviewed", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ progress: { pending: 0, completed: 4, skipped: 0 } })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/annotation-queues");
    expect(wrapper.find('[data-testid="inbox"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("all caught up");
  });
});
