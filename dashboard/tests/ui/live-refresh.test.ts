import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { TRACE_API } from "@/dependency-container";
import { setRefreshSeconds, useLiveRefresh } from "@/ui/composables/useLiveRefresh";
import TraceDetailPage from "@/ui/pages/TraceDetailPage.vue";
import TracesPage from "@/ui/pages/TracesPage.vue";
import { FakeTraceApi, node, summary } from "../fakes";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  setRefreshSeconds(0);
  vi.useRealTimers();
});

describe("useLiveRefresh", () => {
  it("calls back every N seconds, only while enabled", async () => {
    const callback = vi.fn();
    const scope = effectScope();
    scope.run(() => useLiveRefresh(callback));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(callback).not.toHaveBeenCalled(); // Off

    setRefreshSeconds(5);
    await nextTick();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(callback).toHaveBeenCalledTimes(3);

    setRefreshSeconds(0);
    await nextTick();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(callback).toHaveBeenCalledTimes(3);
    scope.stop();
  });

  it("skips ticks while a request is in flight, or while inactive", async () => {
    const callback = vi.fn();
    let busy = true;
    let active = true;
    const scope = effectScope();
    scope.run(() => useLiveRefresh(callback, { isBusy: () => busy, active: () => active }));
    setRefreshSeconds(5);
    await nextTick();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callback).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callback).toHaveBeenCalledTimes(1);
    active = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callback).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("pauses in a hidden tab and refreshes immediately when it becomes visible again", async () => {
    const callback = vi.fn();
    const scope = effectScope();
    scope.run(() => useLiveRefresh(callback));
    setRefreshSeconds(5);
    await nextTick();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callback).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(callback).toHaveBeenCalledTimes(1); // sin esperar al siguiente tick
    scope.stop();
  });

  it("stops the timer when the scope is disposed and persists the choice", async () => {
    const callback = vi.fn();
    const scope = effectScope();
    scope.run(() => useLiveRefresh(callback));
    setRefreshSeconds(10);
    expect(localStorage.getItem("memtrace.refresh")).toBe("10");
    scope.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).not.toHaveBeenCalled();
  });
});

async function mountPage(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/traces", name: "traces", component: { template: "<div />" } },
      { path: "/traces/:traceId", name: "trace", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, { global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api } } });
  await vi.advanceTimersByTimeAsync(0);
  await flushPromises();
  return wrapper;
}

describe("TracesPage live refresh", () => {
  const trace = (id: string, name: string, minutesAgo: number) =>
    summary({ traceId: id.repeat(32), rootSpanName: name, startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString() });

  it("brings in new traces on its own, highlights them, and keeps pages loaded with 'load more'", async () => {
    const api = new FakeTraceApi();
    api.pages = [
      { items: [trace("2", "segunda", 2), trace("1", "primera", 3)], nextCursor: "1" },
      { items: [trace("0", "cero", 4)], nextCursor: null },
    ];
    setRefreshSeconds(5);
    const wrapper = await mountPage(TracesPage, api, "/traces?range=24h");
    await wrapper.findAll("button").find((b) => b.text().includes("Cargar más"))!.trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(wrapper.text()).toContain("cero");

    // llega una traza nueva: la primera página cambia
    api.pages[0] = { items: [trace("3", "nueva", 0), trace("2", "segunda", 2)], nextCursor: "1" };
    const callsBefore = api.listCalls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(api.listCalls.length).toBeGreaterThan(callsBefore);
    expect(wrapper.text()).toContain("nueva");
    expect(wrapper.text()).toContain("cero"); // la página cargada con "Cargar más" sigue ahí
    expect(wrapper.find("tr.row-new").text()).toContain("nueva");

    await vi.advanceTimersByTimeAsync(3_100); // el resaltado se apaga
    expect(wrapper.find("tr.row-new").exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not fetch by itself when set to Off", async () => {
    const api = new FakeTraceApi();
    const wrapper = await mountPage(TracesPage, api, "/traces");
    const calls = api.listCalls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.listCalls.length).toBe(calls);
    wrapper.unmount();
  });
});

describe("TraceDetailPage live refresh", () => {
  const detail = (roots: ReturnType<typeof node>[]) => ({
    traceId: "b".repeat(32), startTime: new Date(Date.now() - 5_000).toISOString(), durationMs: 50, status: "ok" as const,
    spanCount: roots.length, errorCount: 0, totalTokens: 0, truncated: false, roots,
  });

  it("keeps refreshing while the root span is missing, then stops once it arrives", async () => {
    const api = new FakeTraceApi();
    api.detail = detail([node({ spanId: "c", parentSpanId: "r", orphan: true, name: "hijo" })]);
    setRefreshSeconds(5);
    const wrapper = await mountPage(TraceDetailPage, api, `/traces/${"b".repeat(32)}`, { traceId: "b".repeat(32) });
    expect(wrapper.text()).toContain("sigue en curso");

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(api.traceCalls).toBe(2);

    // llega el raíz: la traza está completa
    api.detail = detail([node({ spanId: "r", name: "raiz", children: [node({ spanId: "c", parentSpanId: "r", name: "hijo" })] })]);
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(api.traceCalls).toBe(3);
    expect(wrapper.text()).not.toContain("sigue en curso");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.traceCalls).toBe(3); // ya no refresca
    wrapper.unmount();
  });

  it("does not poll a complete trace", async () => {
    const api = new FakeTraceApi();
    api.detail = detail([node({ spanId: "r", name: "raiz" })]);
    setRefreshSeconds(5);
    const wrapper = await mountPage(TraceDetailPage, api, `/traces/${"b".repeat(32)}`, { traceId: "b".repeat(32) });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.traceCalls).toBe(1);
    wrapper.unmount();
  });
});
