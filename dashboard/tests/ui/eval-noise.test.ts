import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import OfflineCompareView from "@/ui/components/OfflineCompareView.vue";
import OfflineRunView from "@/ui/components/OfflineRunView.vue";
import RunVariability from "@/ui/components/RunVariability.vue";
import RunsPage from "@/ui/pages/RunsPage.vue";

vi.mock("@/ui/components/EChart.vue", () => ({ default: { name: "EChart", template: '<div class="echart-stub" />' } }));
import { FakeIdentityApi, FakeTraceApi, runListItem, scoreAggregate } from "../fakes";
import type { RunNoiseComparisonResponse, RunVariabilityResponse } from "@contract";

async function mountWith(component: object, props: object, api: FakeTraceApi) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }, { path: "/datasets/:datasetId/runs/:runId", name: "dataset-run", component: { template: "<div />" } }, { path: "/datasets", name: "datasets", component: { template: "<div />" } }, { path: "/runs", name: "runs", component: { template: "<div />" } }] });
  await router.push("/");
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, { global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } } });
  await flushPromises();
  return wrapper;
}

const G = "7d9f6c44-0f5a-4d6e-9d0e-2d1c5a2b9e11";
const variability = (over: Partial<RunVariabilityResponse> = {}): RunVariabilityResponse => ({
  group: { id: G, total: 3, completed: 3 },
  executions: [1, 2, 3].map((index) => ({ runId: `e${index}`, index, status: "completed" as const, createdAt: "2026-10-12T10:00:00Z", aggregates: [] })),
  evaluators: [{ name: "exact_match", dataType: "boolean", values: [0.88, 0.92, 0.9], mean: 0.9, noise: 0.02 }],
  instability: [{ evaluator: "exact_match", unstable: 1, total: 10 }],
  unstableItems: [{ itemIndex: 3, input: "My parcel never arrived", evaluator: "exact_match", outcomes: ["true", "false", "true"] }],
  ...over,
});

describe("RunVariability", () => {
  it("shows each execution, the mean, the noise and the unstable items", async () => {
    const api = new FakeTraceApi();
    api.runVariability = variability();
    const wrapper = await mountWith(RunVariability, { runId: "e1" }, api);
    const row = wrapper.get('[data-testid="variability-row"]');
    expect(row.text()).toContain("exact_match");
    expect(row.text()).toContain("88%");
    expect(row.text()).toContain("90%");
    expect(row.text()).toContain("±2.0 pp");
    expect(row.text()).toContain("1 of 10");
    expect(wrapper.get('[data-testid="unstable-item"]').text()).toContain("My parcel never arrived");
    expect(wrapper.find('[data-testid="rough-estimate"]').exists()).toBe(false);
  });

  it("warns that the noise is a rough estimate with fewer than three executions", async () => {
    const api = new FakeTraceApi();
    api.runVariability = variability({ group: { id: G, total: 2, completed: 2 }, executions: variability().executions.slice(0, 2), evaluators: [{ name: "exact_match", dataType: "boolean", values: [0.88, 0.92], mean: 0.9, noise: 0.028 }] });
    const wrapper = await mountWith(RunVariability, { runId: "e1" }, api);
    expect(wrapper.get('[data-testid="rough-estimate"]').text()).toContain("rough estimate");
  });

  it("teaches how to measure the noise when the run was not repeated", async () => {
    const api = new FakeTraceApi();
    api.runVariability = variability({ group: null, executions: [], evaluators: [], instability: [], unstableItems: [] });
    const wrapper = await mountWith(RunVariability, { runId: "solo" }, api);
    const card = wrapper.get('[data-testid="no-repeats"]');
    expect(card.text()).toContain("repeats=3");
    expect(card.text()).toContain("N times");
  });

  it("shows an error with a retry instead of an empty table", async () => {
    const api = new FakeTraceApi();
    api.runVariability = new Error("boom");
    const wrapper = await mountWith(RunVariability, { runId: "e1" }, api);
    expect(wrapper.text()).toContain("boom");
  });
});

describe("OfflineRunView", () => {
  it("has a Variability tab that opens the executions of the run", async () => {
    const api = new FakeTraceApi();
    api.runVariability = variability();
    const runs = [{ ...runListItem({ id: "e1", name: "prompt-v7" }), executions: 3 }];
    const wrapper = await mountWith(OfflineRunView, { runs, runId: "e1" }, api);
    expect(wrapper.get('[data-testid="tab-variability"]').text()).toContain("3");
    await wrapper.get('[data-testid="tab-variability"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="variability-row"]').exists()).toBe(true);
  });
});

describe("OfflineCompareView verdicts", () => {
  const comparison = (evaluators: RunNoiseComparisonResponse["evaluators"]): RunNoiseComparisonResponse => ({ baseline: { runId: "a", executions: 3 }, candidate: { runId: "b", executions: 1 }, evaluators });
  const runs = [
    runListItem({ id: "a", name: "prompt-v6", createdAt: "2026-10-10T10:00:00Z", aggregates: [scoreAggregate({ name: "exact_match", passRate: 0.86 })] }),
    runListItem({ id: "b", name: "prompt-v7", createdAt: "2026-10-12T10:00:00Z", aggregates: [scoreAggregate({ name: "exact_match", passRate: 0.9 })] }),
  ];

  it("labels each delta as above the noise, within it or not measured", async () => {
    const api = new FakeTraceApi();
    api.noiseComparison = comparison([{ name: "exact_match", dataType: "boolean", baseline: 0.86, candidate: 0.9, delta: 0.04, margin: 0.02, noise: 0.01, verdict: "above", reason: null }]);
    const wrapper = await mountWith(OfflineCompareView, { runs, initialIds: ["a", "b"] }, api);
    expect(api.noiseComparisonCalls).toEqual([["a", "b"]]);
    expect(wrapper.get('[data-testid="noise-verdict"]').text()).toBe("Above noise");

    api.noiseComparison = comparison([{ name: "exact_match", dataType: "boolean", baseline: 0.86, candidate: 0.9, delta: 0.04, margin: 0.08, noise: 0.03, verdict: "within", reason: null }]);
    const within = await mountWith(OfflineCompareView, { runs, initialIds: ["a", "b"] }, api);
    expect(within.get('[data-testid="noise-verdict"]').text()).toBe("Within noise");

    api.noiseComparison = comparison([{ name: "exact_match", dataType: "boolean", baseline: 0.86, candidate: 0.9, delta: 0.04, margin: null, noise: null, verdict: "not_measured", reason: "no_repetitions" }]);
    const none = await mountWith(OfflineCompareView, { runs, initialIds: ["a", "b"] }, api);
    expect(none.get('[data-testid="noise-verdict"]').text()).toBe("Not measured");
    expect(none.text()).toContain("repeats=3");
  });

  it("still shows the comparison, without verdicts, when the noise cannot be read", async () => {
    const api = new FakeTraceApi();
    api.noiseComparison = new Error("noise unavailable");
    const wrapper = await mountWith(OfflineCompareView, { runs, initialIds: ["a", "b"] }, api);
    expect(wrapper.find('[data-testid="noise-verdict"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("exact_match");
  });
});

describe("RunsPage groups executions", () => {
  it("shows the executions of a repeated run as one row with their mean", async () => {
    const api = new FakeTraceApi();
    const exec = (id: string, index: number, passRate: number) => ({ ...runListItem({ id, name: "prompt-v7", aggregates: [scoreAggregate({ name: "exact_match", passRate })] }), runGroup: { id: G, index, total: 3 } });
    api.runs = { items: [exec("e1", 1, 0.88), exec("e2", 2, 0.92), exec("e3", 3, 0.9), runListItem({ id: "solo", name: "baseline" })] };
    const wrapper = await mountWith(RunsPage, {}, api);
    const rows = wrapper.findAll("tr.run-row");
    expect(rows).toHaveLength(2);
    expect(wrapper.get('[data-testid="executions-pill"]').text()).toContain("× 3");
    expect(rows.map((r) => r.text()).join(" ")).toContain("90");
  });
});
