import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { BreakdownItemDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME } from "@/application/identity-api";
import BreakdownPage from "@/ui/pages/BreakdownPage.vue";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Overview › Breakdown: una tabla de versiones o entornos, con su margen y la comparación de dos filas

const item = (key: string, over: Partial<BreakdownItemDto> = {}): BreakdownItemDto => ({
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
    { path: "/e/:experimentId/overview/breakdown", name: "overview-breakdown", component: { template: "<div />" } },
    { path: "/e/:experimentId/overview/charts", name: "overview-charts", component: { template: "<div />" } },
    { path: "/model-pricing", name: "model-pricing", component: { template: "<div />" } },
    { path: "/prompts", name: "prompts", component: { template: "<div />" } },
  ] });
  await router.push(`/e/exp-1/overview/breakdown${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(BreakdownPage))) });
  mounted = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: trace, [IDENTITY_API as symbol]: new FakeIdentityApi(), [CURRENT_EXPERIMENT as symbol]: { value: { id: "exp-1", organizationId: "org-1", name: "Weather", serviceName: "weather", myRole: "technical", permissions: [], organizationTheme: EMPTY_THEME } } } },
  });
  await flushPromises();
  return router;
}
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);

describe("Breakdown page", () => {
  it("lists every version in one table, grouped by prompt version by default", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("weather-system v3"), item("weather-system v4", { related: ["pre"], errorRate: 0.018, errorMargin: 0.019 })] };
    await open(trace);
    expect(trace.breakdownCalls).toEqual(["prompt_version"]);
    expect(q("row-weather-system v3")).toBeTruthy();
    expect(q("row-weather-system v4")?.textContent).toContain("±1.9");
    expect(document.body.textContent).toContain("Prompt version");
  });

  it("warns about the worst version when its range does not overlap the best one", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("weather-system v3"), item("weather-system v4", { errorRate: 0.018, errorMargin: 0.019 })] };
    await open(trace);
    expect(q("breakdown-insight")?.textContent).toContain("weather-system v3 fails 9.4% of the time");
  });

  it("tells what to do before anything is picked: two empty slots and a hint", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("a v1"), item("b v1")] };
    await open(trace);
    expect(q("slot-A")?.textContent).toContain("Click a row to set the baseline");
    expect(q("slot-B")?.textContent).toContain("Then click a second row");
    expect(q("pair-hint")?.textContent).toContain("first the baseline (A), then the candidate (B)");
    expect(q("breakdown-compare")).toBeNull();
    expect(q("breakdown-compare-empty")).toBeTruthy();
    expect(q("pick-a v1")!.textContent).toContain("A");
  });

  it("fills A then B and compares them, and says when they run in different places", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "environment", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("pro"), item("pre", { related: ["weather-system v4"], errorRate: 0.016, errorMargin: 0.009, p95Ms: 2200 })] };
    await open(trace, "?groupBy=environment");
    expect(q("breakdown-compare")).toBeNull();
    q<HTMLButtonElement>("pick-pro")!.click();
    await flushPromises();
    expect(q("slot-A")?.textContent).toContain("pro");
    expect(q("pair-hint")?.textContent).toContain("Now pick the candidate (B)");
    q<HTMLButtonElement>("pick-pre")!.click();
    await flushPromises();
    expect(q("slot-B")?.textContent).toContain("pre");
    expect(q("breakdown-compare")).toBeTruthy();
    expect(q("delta-ERRORS")?.textContent).toContain("Ranges do not overlap: reliable");
    expect(q("delta-P95 LATENCY")?.textContent).toContain("faster");
    expect(q("compare-differs")?.textContent).toContain("Run different versions");
  });

  it("clicking a picked row clears it, and a third row replaces B", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("a v1"), item("b v1"), item("c v1")] };
    await open(trace);
    for (const k of ["a v1", "b v1", "c v1"]) {
      q<HTMLButtonElement>(`pick-${k}`)!.click();
      await flushPromises();
    }
    expect(q<HTMLButtonElement>("pick-a v1")!.getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLButtonElement>("pick-b v1")!.getAttribute("aria-pressed")).toBe("false");
    expect(q("breakdown-compare")?.textContent).toContain("c v1");
    q<HTMLButtonElement>("pick-a v1")!.click();
    await flushPromises();
    expect(q("slot-A")?.textContent).toContain("Click a row to set the baseline");
    expect(q("breakdown-compare")).toBeNull();
  });

  it("picks the pair from the warning: best as A, worst as B", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("v3"), item("v4", { errorRate: 0.018, errorMargin: 0.019 })] };
    await open(trace);
    q("insight-compare")!.click();
    await flushPromises();
    expect(q("slot-A")?.textContent).toContain("v4");
    expect(q("slot-B")?.textContent).toContain("v3");
    expect(q("breakdown-compare")).toBeTruthy();
  });

  it("with a single version nothing can be picked and it explains how to get a second one", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 0, items: [item("system-prompt v3", { related: ["dev"] })] };
    await open(trace);
    expect(q("slot-A")?.textContent).toContain("system-prompt v3");
    expect(q("slot-B")?.textContent).toContain("No second version yet");
    expect(q<HTMLButtonElement>("pick-system-prompt v3")!.disabled).toBe(true);
    expect(q("breakdown-guide")?.textContent).toContain("You need a second version to compare");
    expect(q("breakdown-compare")).toBeNull();
  });

  it("dims versions with too few traces and flags unpriced tokens", async () => {
    const trace = new FakeTraceApi();
    trace.breakdown = { groupBy: "prompt_version", range: { from: "", to: "" }, unpricedTokens: 12_400, items: [item("summary v1", { traces: 12 }), item("summary v3")] };
    await open(trace);
    expect(q("row-summary v1")?.textContent).toContain("few traces");
    expect(q("breakdown-unpriced")?.textContent).toContain("12.4K");
  });

  it("switches to environments and explains how to get data when the table is empty", async () => {
    const trace = new FakeTraceApi();
    const router = await open(trace);
    expect(q("breakdown-empty")?.textContent).toContain("memtrace.prompts");
    q("tab-environment")!.click();
    await flushPromises();
    expect(router.currentRoute.value.query.groupBy).toBe("environment");
    expect(trace.breakdownCalls).toEqual(["prompt_version", "environment"]);
    expect(q("breakdown-empty")?.textContent).toContain("environment=");
  });

  it("offers User as a coming tab, disabled", async () => {
    await open(new FakeTraceApi());
    expect(q<HTMLButtonElement>("tab-user")!.disabled).toBe(true);
  });
});
