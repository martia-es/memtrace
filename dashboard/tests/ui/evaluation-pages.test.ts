import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import DatasetsPage from "@/ui/pages/DatasetsPage.vue";
import DatasetDetailPage from "@/ui/pages/DatasetDetailPage.vue";
import DatasetRunDetailPage from "@/ui/pages/DatasetRunDetailPage.vue";
import RunsPage from "@/ui/pages/RunsPage.vue";
import { FakeIdentityApi, FakeTraceApi, datasetDto, datasetItemDto, datasetRunItem, datasetRunSummary, datasetVersionDto, runListItem, scoreAggregate } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/datasets", name: "datasets", component: { template: "<div />" } },
      { path: "/datasets/:datasetId", name: "dataset", component: { template: "<div />" } },
      { path: "/runs", name: "runs", component: { template: "<div />" } },
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
    expect(wrapper.text()).toContain("2+2?");
  });

  it("renders a table row per run in the Runs tab and opens one", async () => {
    const api = new FakeTraceApi();
    api.datasetById = { "ds-1": datasetDto() };
    api.datasetVersions = { "ds-1": { items: [datasetVersionDto()] } };
    api.datasetRuns = { "ds-1": { items: [datasetRunSummary()] } };

    const { wrapper, router } = await setup(DatasetDetailPage, api, "/datasets/ds-1");
    await clickTab(wrapper, "Runs");

    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-v1");
    expect(wrapper.find("tbody tr .mt-pill").text()).toContain("66 %");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dataset-run");
    expect(router.currentRoute.value.params).toMatchObject({ datasetId: "ds-1", runId: "run-1" });
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
    expect(headers).toEqual(["Run", "Dataset", "Version", "exact_match", "Items", "Created"]);
    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-v1");
    expect(wrapper.find("tbody tr").text()).toContain("toy-agent-smoke-test");
    expect(wrapper.find("tbody tr .mt-pill").text()).toContain("66 %");

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dataset-run");
    expect(router.currentRoute.value.params).toMatchObject({ datasetId: "ds-1", runId: "run-1" });
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
    expect(wrapper.text()).toContain("66 %");
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
