import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AnalyticsItemDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME } from "@/application/identity-api";
import AnalyticsPage from "@/ui/pages/AnalyticsPage.vue";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Overview › Analytics: una tabla de versiones o entornos, con su margen y la comparación de dos filas

const item = (key: string, over: Partial<AnalyticsItemDto> = {}): AnalyticsItemDto => ({
  key, related: ["pro"], traces: 400, errorTraces: 38, errorRate: 0.094, errorMargin: 0.028, p95Ms: 3800, inputTokens: 1000, outputTokens: 100,
  costUsd: 5, costPerTraceUsd: 0.0125, costComplete: true, thumbsUpRate: 0.72, ratedTraces: 60,
  trend: Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-0${i + 1}T00:00:00.000Z`, traces: 50, errorTraces: i })), ...over,
});

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function open(trace: FakeTraceApi, query = "") {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/e/:experimentId/overview/analytics", name: "overview-analytics", component: { template: "<div />" } },
    { path: "/e/:experimentId/overview/charts", name: "overview-charts", component: { template: "<div />" } },
    { path: "/model-pricing", name: "model-pricing", component: { template: "<div />" } },
  ] });
  await router.push(`/e/exp-1/overview/analytics${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(AnalyticsPage))) });
  mounted = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: trace, [IDENTITY_API as symbol]: new FakeIdentityApi(), [CURRENT_EXPERIMENT as symbol]: { value: { id: "exp-1", organizationId: "org-1", name: "Weather", serviceName: "weather", myRole: "technical", permissions: [], organizationTheme: EMPTY_THEME } } } },
  });
  await flushPromises();
  return router;
}
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);

describe("Analytics page", () => {
  it("lists every version in one table, grouped by prompt version by default", async () => {
    const trace = new FakeTraceApi();
    trace.analytics = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("weather-system v3"), item("weather-system v4", { related: ["pre"], errorRate: 0.018, errorMargin: 0.019 })] };
    await open(trace);
    expect(trace.analyticsCalls).toEqual(["prompt_version"]);
    expect(q("row-weather-system v3")).toBeTruthy();
    expect(q("row-weather-system v4")?.textContent).toContain("±1.9");
    expect(document.body.textContent).toContain("Prompt version");
  });

  it("warns about the worst version when its range does not overlap the best one", async () => {
    const trace = new FakeTraceApi();
    trace.analytics = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("weather-system v3"), item("weather-system v4", { errorRate: 0.018, errorMargin: 0.019 })] };
    await open(trace);
    expect(q("analytics-insight")?.textContent).toContain("weather-system v3 fails 9.4% of the time");
  });

  it("compares two ticked rows, and says when they run in different places", async () => {
    const trace = new FakeTraceApi();
    trace.analytics = { groupBy: "environment", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("pro"), item("pre", { related: ["weather-system v4"], errorRate: 0.016, errorMargin: 0.009, p95Ms: 2200 })] };
    await open(trace, "?groupBy=environment");
    expect(q("analytics-compare")).toBeNull();
    q<HTMLInputElement>("pick-pro")!.click();
    q<HTMLInputElement>("pick-pre")!.click();
    await flushPromises();
    expect(q("analytics-compare")).toBeTruthy();
    expect(q("delta-ERRORS")?.textContent).toContain("Ranges do not overlap: reliable");
    expect(q("delta-P95 LATENCY")?.textContent).toContain("faster");
    expect(q("compare-differs")?.textContent).toContain("Run different versions");
  });

  it("keeps only the last two ticked rows", async () => {
    const trace = new FakeTraceApi();
    trace.analytics = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("a v1"), item("b v1"), item("c v1")] };
    await open(trace);
    for (const k of ["a v1", "b v1", "c v1"]) {
      q<HTMLInputElement>(`pick-${k}`)!.click();
      await flushPromises();
    }
    expect(q<HTMLInputElement>("pick-a v1")!.checked).toBe(false);
    expect(q("analytics-compare")?.textContent).toContain("b v1");
  });

  it("dims versions with too few traces and flags unpriced tokens", async () => {
    const trace = new FakeTraceApi();
    trace.analytics = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 12_400, items: [item("summary v1", { traces: 12 }), item("summary v3")] };
    await open(trace);
    expect(q("row-summary v1")?.textContent).toContain("few traces");
    expect(q("analytics-unpriced")?.textContent).toContain("12.4K");
  });

  it("switches to environments and explains how to get data when the table is empty", async () => {
    const trace = new FakeTraceApi();
    const router = await open(trace);
    expect(q("analytics-empty")?.textContent).toContain("memtrace.prompts");
    q("group-environment")!.click();
    await flushPromises();
    expect(router.currentRoute.value.query.groupBy).toBe("environment");
    expect(trace.analyticsCalls).toEqual(["prompt_version", "environment"]);
    expect(q("analytics-empty")?.textContent).toContain("environment=");
  });

  it("offers User as a coming feature, disabled", async () => {
    await open(new FakeTraceApi());
    expect(q<HTMLButtonElement>("group-user")!.disabled).toBe(true);
  });
});
