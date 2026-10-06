import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import DatasetsPage from "@/ui/pages/DatasetsPage.vue";
import DatasetDetailPage from "@/ui/pages/DatasetDetailPage.vue";
import DatasetRunDetailPage from "@/ui/pages/DatasetRunDetailPage.vue";
import RunsPage from "@/ui/pages/RunsPage.vue";

// ECharts needs a real canvas, which jsdom does not have: the charts are not what these tests are about
vi.mock("@/ui/components/EChart.vue", () => ({ default: { name: "EChart", template: '<div class="echart-stub" />' } }));
import { chooseOption, optionLabels } from "./select";
import { FakeIdentityApi, FakeTraceApi, datasetDto, datasetItemDto, datasetRunItem, datasetRunSummary, datasetVersionDto, runListItem, scoreAggregate } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/overview", name: "overview", component: { template: "<div />" } },
      { path: "/datasets", name: "datasets", component: { template: "<div />" } },
      { path: "/datasets/:datasetId", name: "dataset", component: { template: "<div />" } },
      { path: "/runs", name: "runs", component: { template: "<div />" } },
      { path: "/trends", name: "trends", component: { template: "<div />" } },
      { path: "/datasets/:datasetId/runs/:runId", name: "dataset-run", component: { template: "<div />" } },
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

async function clickTab(wrapper: ReturnType<typeof mount>, label: string) {
  const tabs = wrapper.findAll('[role="tab"]');
  const tab = tabs.find((t) => t.text() === label);
  if (!tab) throw new Error(`tab "${label}" not found`);
  await tab.trigger("click");
  await flushPromises();
}

describe("DatasetsPage", () => {
  it("renders a table row per dataset and opens it on click", async () => {
    const api = new FakeTraceApi();
    api.datasets = { items: [datasetDto()] };

    const { wrapper, router } = await setup(DatasetsPage, api, "/datasets");
    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toEqual(["Dataset", "Version", "Runs", "Created"]);
    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-smoke-test");
    expect(wrapper.find("tbody tr").text()).toContain("v1");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dataset");
    expect(router.currentRoute.value.params.datasetId).toBe("ds-1");
  });

  it("filters by name", async () => {
    const api = new FakeTraceApi();
    api.datasets = { items: [datasetDto({ id: "ds-1", name: "good-agent" }), datasetDto({ id: "ds-2", name: "bad-agent" })] };
    const { wrapper } = await setup(DatasetsPage, api, "/datasets");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);

    await wrapper.find("input").setValue("good");
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.find("tbody tr").text()).toContain("good-agent");
  });

  it("shows an empty state when there are no datasets", async () => {
    const api = new FakeTraceApi();
    api.datasets = { items: [] };
    const { wrapper } = await setup(DatasetsPage, api, "/datasets");
    expect(wrapper.text()).toContain("No datasets yet");
  });
});

describe("DatasetDetailPage", () => {
  it("shows the dataset name and its latest-version items by default", async () => {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = { "ds-1": { items: [datasetVersionDto()] } };
    api.datasetItems = { "ds-1": { items: [datasetItemDto({ input: "2+2?" })] } };

    const { wrapper } = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    expect(wrapper.text()).toContain("toy-agent-smoke-test");
    expect((wrapper.find('textarea[aria-label="Input of row 1"]').element as HTMLTextAreaElement).value).toBe("2+2?");
  });

  it("renders a table row per run in the Runs tab and opens one", async () => {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = { "ds-1": { items: [datasetVersionDto()] } };
    api.datasetRuns = { "ds-1": { items: [datasetRunSummary()] } };

    const { wrapper, router } = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    await clickTab(wrapper, "Runs");

    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-v1");
    expect(wrapper.find("tbody tr .mt-pill").text()).toContain("66%");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dataset-run");
    expect(router.currentRoute.value.params).toMatchObject({ datasetId: "ds-1", runId: "run-1" });
  });

  it("lists versions in a flat table with real change counts and opens a diff modal against the previous one", async () => {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = {
      "ds-1": {
        items: [
          datasetVersionDto({ id: "v3", major: 1, minor: 2, note: "Edited item", modifiedCount: 1 }),
          datasetVersionDto({ id: "v2", major: 1, minor: 1, note: "Added item", addedCount: 1 }),
          datasetVersionDto({ id: "v1", major: 1, minor: 0, note: null }),
        ],
      },
    };
    api.datasetVersionDiffs = {
      "v3:v2": {
        base: { id: "v2", major: 1, minor: 1 },
        target: { id: "v3", major: 1, minor: 2 },
        unchangedCount: 2,
        changes: [
          {
            originItemId: "a",
            kind: "modified",
            before: datasetItemDto({ input: "2+2?", expectedOutput: "4" }),
            after: datasetItemDto({ input: "2+2?", expectedOutput: "four", updatedByEmail: "luis@example.com", updatedAt: "2026-10-02T10:00:00Z" }),
          },
        ],
      },
    };

    const { wrapper } = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    await clickTab(wrapper, "Versions");

    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toContain("~1");
    expect(rows[1]!.text()).toContain("+1");
    expect(rows[2]!.text()).not.toMatch(/[+~−]\d/);

    await rows[0]!.find("button").trigger("click");
    await flushPromises();
    expect(api.datasetVersionDiffCalls).toEqual([{ versionId: "v3", againstVersionId: "v2" }]);
    const modal = document.body;
    expect(modal.textContent).toContain("luis@example.com");
    expect(modal.textContent).toContain("2 unchanged items");
    expect(modal.textContent).toContain("Changes from v1.1 to v1.2");
    expect(modal.textContent).toContain("Modified since v1.1");
    expect(modal.querySelectorAll(".line.del")).toHaveLength(1);
    expect(modal.querySelector(".line.add")?.textContent).toContain("four");

    // comparar con una versión no adyacente
    expect(await optionLabels(modal, "#compare-with")).toEqual(["v1.1 — Added item", "v1.0"]);
    await chooseOption(modal, "#compare-with", "v1.0");
    expect(api.datasetVersionDiffCalls.at(-1)).toEqual({ versionId: "v3", againstVersionId: "v1" });
    wrapper.unmount();
  });

  it("shows an empty state when the dataset has no runs", async () => {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = { "ds-1": { items: [datasetVersionDto()] } };
    api.datasetRuns = { "ds-1": { items: [] } };
    const { wrapper } = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    await clickTab(wrapper, "Runs");
    expect(wrapper.text()).toContain("No runs yet");
  });
});

describe("RunsPage", () => {
  it("renders a table row per run across all datasets, with the dataset name, and opens one", async () => {
    const api = new FakeTraceApi();
    api.runs = { items: [runListItem()] };

    const { wrapper, router } = await setup(RunsPage, api, "/runs");
    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toEqual(["", "Run", "Dataset", "When", "exact_match", "Items", "Status"]);
    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-v1");
    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-smoke-test");
    expect(wrapper.find("tbody tr .mt-pill").text()).toContain("66%");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dataset-run");
    expect(router.currentRoute.value.params).toMatchObject({ datasetId: "ds-1", runId: "run-1" });
  });

  it("compares two completed runs: ticking them shows the compare bar and deep-links to the offline comparison", async () => {
    const api = new FakeTraceApi();
    api.runs = { items: [runListItem({ id: "run-a", name: "baseline" }), runListItem({ id: "run-b", name: "candidate" }), runListItem({ id: "run-c", name: "still-running", status: "running" })] };
    const { wrapper, router } = await setup(RunsPage, api, "/runs");
    expect(wrapper.find('[data-testid="compare-bar"]').exists()).toBe(false);

    const boxes = wrapper.findAll('[data-testid="pick-run"]');
    expect(boxes[2]!.attributes("disabled")).toBeDefined(); // only completed runs can be compared
    await boxes[0]!.setValue(true);
    expect(wrapper.get('[data-testid="compare-go"]').attributes("disabled")).toBeDefined(); // one is not enough
    await boxes[1]!.setValue(true);
    expect(wrapper.get('[data-testid="compare-bar"]').text()).toContain("baseline (baseline) vs candidate");
    expect(router.currentRoute.value.name).toBe("runs"); // ticking never opens the run

    await wrapper.get('[data-testid="compare-go"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("trends");
    expect(router.currentRoute.value.query).toMatchObject({ compare: "run-a,run-b" });
  });

  it("filters by dataset and by run/dataset name", async () => {
    const api = new FakeTraceApi();
    api.runs = { items: [runListItem({ id: "run-1", datasetId: "ds-1", datasetName: "good-agent" }), runListItem({ id: "run-2", datasetId: "ds-2", datasetName: "bad-agent" })] };
    const { wrapper } = await setup(RunsPage, api, "/runs");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);

    await wrapper.find("input").setValue("good");
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.find("tbody tr").text()).toContain("good-agent");
  });

  it("shows an empty state when there are no runs", async () => {
    const api = new FakeTraceApi();
    api.runs = { items: [] };
    const { wrapper } = await setup(RunsPage, api, "/runs");
    expect(wrapper.text()).toContain("No runs yet");
  });
});

describe("DatasetRunDetailPage", () => {
  it("shows the artifacts panel, a KPI per aggregate, and one row per item with its scores", async () => {
    const api = new FakeTraceApi();
    api.datasetRunDetail = {
      dataset: { id: "ds-1", name: "toy-agent-smoke-test" },
      run: datasetRunSummary({ aggregates: [scoreAggregate({ name: "exact_match", passRate: 0.66 }), scoreAggregate({ name: "contains", passRate: 1 })] }),
      items: [datasetRunItem({ input: "capital of Spain?", output: "Barcelona", expectedOutput: "Madrid", scores: [{ name: "exact_match", value: "false", dataType: "boolean", source: "code", comment: null }] })],
    };
    const { wrapper } = await setup(DatasetRunDetailPage, api, "/datasets/ds-1/runs/run-1");

    expect(wrapper.text()).toContain("toy-agent-smoke-test");
    expect(wrapper.text()).toContain("Agent version:");
    expect(wrapper.text()).toContain("toy-agent-v1");
    expect(wrapper.text()).toContain("66%");
    expect(wrapper.text()).toContain("capital of Spain?");
    expect(wrapper.text()).toContain("Barcelona");
    expect(wrapper.find(".mt-pill.error").text()).toContain("exact_match=false");
  });

  it("labels an llm_judge score so it's distinguishable from a code-based one", async () => {
    const api = new FakeTraceApi();
    api.datasetRunDetail = {
      dataset: { id: "ds-1", name: "toy-agent-smoke-test" },
      run: datasetRunSummary({ aggregates: [] }),
      items: [datasetRunItem({ scores: [{ name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: null }] })],
    };
    const { wrapper } = await setup(DatasetRunDetailPage, api, "/datasets/ds-1/runs/run-1");
    expect(wrapper.find(".mt-pill.ok").text()).toContain("LLM");
  });

  it("shows the task error instead of the output when the item failed", async () => {
    const api = new FakeTraceApi();
    api.datasetRunDetail = {
      dataset: { id: "ds-1", name: "toy-agent-smoke-test" },
      run: datasetRunSummary({ aggregates: [] }),
      items: [datasetRunItem({ output: null, error: "boom", scores: [] })],
    };
    const { wrapper } = await setup(DatasetRunDetailPage, api, "/datasets/ds-1/runs/run-1");
    expect(wrapper.text()).toContain("error: boom");
  });
});

describe("DatasetDetailPage — spreadsheet editing (ADR-041)", () => {
  async function openEditor() {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = { "ds-1": { items: [datasetVersionDto({ major: 2, minor: 1 })] } };
    api.datasetItems = { "ds-1": { items: [datasetItemDto({ id: "i1", input: "2+2?", expectedOutput: "4" })] } };
    const ctx = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    return { api, ...ctx };
  }

  it("publishes several edits as a single commit and predicts the version", async () => {
    const { api, wrapper } = await openEditor();
    expect(wrapper.find(".publish-bar").exists()).toBe(false);

    const expected = wrapper.find('textarea[aria-label="Expected output of row 1"]');
    await expected.setValue("four");
    const blank = wrapper.findAll("textarea.cell-input").filter((t) => t.attributes("aria-label")?.startsWith("Input of row 2"))[0]!;
    await blank.setValue("3+3?");

    const bar = wrapper.find(".publish-bar");
    expect(bar.text()).toContain("2 unpublished changes");
    expect(bar.text()).toContain("v3.0");

    await bar.find(".primary-btn").trigger("click");
    await flushPromises();
    expect(api.commitDatasetChangesCalls).toHaveLength(1);
    expect(api.commitDatasetChangesCalls[0]!.changes).toEqual({
      add: [{ input: "3+3?", expectedOutput: null, metadata: null }],
      update: [{ id: "i1", expectedOutput: "four" }],
      remove: [],
    });
  });

  it("deleting only marks the row until published, and Discard restores it", async () => {
    const { api, wrapper } = await openEditor();
    await wrapper.find('button[aria-label="Delete"]').trigger("click");
    expect(wrapper.find(".publish-bar").text()).toContain("1 deleted");
    expect(api.deleteDatasetItemCalls).toHaveLength(0);

    const discard = wrapper.findAll(".publish-bar button").find((b) => b.text() === "Discard")!;
    await discard.trigger("click");
    expect(wrapper.find(".publish-bar").exists()).toBe(false);
    expect(api.commitDatasetChangesCalls).toHaveLength(0);
  });
});
