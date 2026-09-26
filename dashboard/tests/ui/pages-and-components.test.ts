import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { TRACE_API } from "@/dependency-container";
import SpanWaterfall from "@/ui/components/SpanWaterfall.vue";
import ErrorBanner from "@/ui/components/ErrorBanner.vue";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import TracesPage from "@/ui/pages/TracesPage.vue";
import { FakeTraceApi, node, summary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/traces", name: "traces", component: { template: "<div />" } },
      { path: "/traces/:traceId", name: "trace", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  // QPage solo funciona dentro de un layout, igual que en la app
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api } },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("TracesPage", () => {
  it("lists traces, loads the next page and shows the empty state", async () => {
    const api = new FakeTraceApi();
    api.pages = [
      { items: [summary({ traceId: "1".repeat(32), rootSpanName: "primera", errorCount: 2 })], nextCursor: "1" },
      { items: [summary({ traceId: "2".repeat(32), rootSpanName: "segunda" })], nextCursor: null },
    ];
    const { wrapper } = await setup(TracesPage, api, "/traces?range=24h");
    expect(wrapper.text()).toContain("primera");
    expect(wrapper.text()).not.toContain("segunda");

    await wrapper.findAll("button").find((b) => b.text().includes("Cargar más"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("segunda");
    expect(api.listCalls.at(-1)?.cursor).toBe("1");
    expect(wrapper.text()).not.toContain("Cargar más");
  });

  it("sends the filters from the URL and explains an empty result", async () => {
    const api = new FakeTraceApi();
    const { wrapper } = await setup(TracesPage, api, "/traces?range=6h&service=svc-a&status=error&hasErrors=1&min=50");
    expect(api.listCalls[0]).toMatchObject({ service: "svc-a", status: "error", hasErrors: true, minDurationMs: 50 });
    const span = Date.parse(api.listCalls[0]!.to) - Date.parse(api.listCalls[0]!.from);
    expect(span).toBe(6 * 3600_000);
    expect(wrapper.text()).toContain("Ninguna traza coincide con los filtros");
  });

  it("navigates to the detail keeping the shared filters", async () => {
    const api = new FakeTraceApi();
    api.pages = [{ items: [summary({ traceId: "c".repeat(32) })], nextCursor: null }];
    const { wrapper, router } = await setup(TracesPage, api, "/traces?range=24h&service=svc-a");
    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trace");
    expect(router.currentRoute.value.params.traceId).toBe("c".repeat(32));
    expect(router.currentRoute.value.query).toMatchObject({ range: "24h", service: "svc-a" });
  });

  it("shows an actionable message when the API is unreachable", async () => {
    const api = new FakeTraceApi();
    api.listTraces = async () => {
      throw new ApiError(0, "Sin conexión");
    };
    const { wrapper } = await setup(TracesPage, api, "/traces");
    expect(wrapper.find('[role="alert"]').text()).toContain("No se pudo contactar con la API");
  });
});

describe("TraceDetailPage / SpanWaterfall", () => {
  const detail = () => {
    const child = node({ spanId: "c1", parentSpanId: "r", name: "llm", kind: "llm", offsetMs: 5, durationMs: 20, status: { code: "error", message: "boom" } });
    const root = node({ spanId: "r", name: "raiz", kind: "agent", durationMs: 50, children: [child] });
    return { traceId: "b".repeat(32), startTime: "2026-09-26T12:00:00.000Z", durationMs: 50, status: "ok" as const, spanCount: 2, errorCount: 1, totalTokens: 0, truncated: false, roots: [root] };
  };

  it("renders the waterfall, selects a span from the URL and shows its error", async () => {
    const api = new FakeTraceApi();
    api.detail = detail();
    const { wrapper } = await setup(TraceDetailPage, api, `/traces/${"b".repeat(32)}?span=c1`, { traceId: "b".repeat(32) });
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(2);
    expect(wrapper.find('[aria-selected="true"]').text()).toContain("llm");
    expect(wrapper.text()).toContain("boom");
  });

  it("collapses and expands children and emits selection on click and keyboard", async () => {
    const d = detail();
    const wrapper = mount(SpanWaterfall, {
      props: { roots: d.roots, totalMs: 50, selectedId: null, collapsed: new Set<string>(["r"]) },
      global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]] },
    });
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(1); // hijo oculto
    await wrapper.find('[role="treeitem"]').trigger("keydown.enter");
    expect(wrapper.emitted("select")?.[0]).toEqual(["r"]);
    await wrapper.find('button[aria-label="Expandir"]').trigger("click");
    expect(wrapper.emitted("toggle")?.[0]).toEqual(["r"]);
  });

  it("warns about orphan spans and truncated traces", async () => {
    const api = new FakeTraceApi();
    const d = detail();
    d.roots = [node({ spanId: "o", name: "huerfano", orphan: true })];
    api.detail = { ...d, truncated: true };
    const { wrapper } = await setup(TraceDetailPage, api, `/traces/${"b".repeat(32)}`, { traceId: "b".repeat(32) });
    expect(wrapper.text()).toContain("más de 5000 spans");
    expect(wrapper.text()).toContain("no tienen padre");
  });

  it("explains a missing trace", async () => {
    const wrapper = mount(ErrorBanner, { props: { error: new ApiError(404, "Not Found") }, global: { plugins: [[Quasar, {}]] } });
    expect(wrapper.text()).toContain("retención");
  });
});
