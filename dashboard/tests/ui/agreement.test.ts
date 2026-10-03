import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { JudgeHumanMetricDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import InterAnnotatorAgreement from "@/ui/components/InterAnnotatorAgreement.vue";
import JudgeHumanAgreement from "@/ui/components/JudgeHumanAgreement.vue";
import DatasetRunDetailPage from "@/ui/pages/DatasetRunDetailPage.vue";
import { FakeIdentityApi, FakeTraceApi, datasetRunItem, datasetRunSummary, queueSummary } from "../fakes";

async function setup(component: object, api: FakeTraceApi, props: Record<string, unknown> = {}, path = "/datasets/ds-1/runs/run-1") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/datasets", name: "datasets", component: { template: "<div />" } },
      { path: "/datasets/:datasetId", name: "dataset", component: { template: "<div />" } },
      { path: "/datasets/:datasetId/runs/:runId", name: "dataset-run", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } },
  });
  await flushPromises();
  return { wrapper };
}

function metric(overrides: Partial<JudgeHumanMetricDto> = {}): JudgeHumanMetricDto {
  return {
    name: "correctness",
    dataType: "boolean",
    status: "ok",
    judge: { model: "claude-x", promptHash: "abc123" },
    judges: [{ model: "claude-x", promptHash: "abc123" }],
    n: 50,
    excluded: { ties: 0, noHuman: 0, noJudge: 0, invalid: 0 },
    percentAgreement: 0.7,
    kappa: 0.4,
    binary: { tp: 20, fp: 5, fn: 10, tn: 15 },
    confusion: { labels: ["true", "false"], matrix: [[20, 10], [5, 15]] },
    lowSample: false,
    disagreements: [{ target: "run:run-1:3", judge: "true", human: "false" }],
    ...overrides,
  };
}

const agreementOf = (metrics: JudgeHumanMetricDto[], extra: Partial<FakeTraceApi["judgeHumanAgreement"]> = {}) => ({
  scope: { type: "run" as const, id: "run-1", traceTargets: 0 },
  metrics,
  unmatched: { judgeOnly: [], humanOnly: [] },
  ...extra,
});

describe("JudgeHumanAgreement (ADR-040)", () => {
  it("asks for the given scope and shows kappa with its reading, agreement, n, the matrix and the disagreements", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric()]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });

    expect(api.judgeHumanCalls[0]).toEqual({ scope: { datasetRunId: "run-1" }, name: undefined });
    const text = wrapper.get('[data-testid="agreement-metric"]').text();
    expect(text).toContain("correctness");
    expect(text).toContain("claude-x · rubric abc123");
    expect(wrapper.get('[data-testid="agreement-kappa"]').text()).toBe("0.40");
    expect(text).toContain("fair");
    expect(text).toContain("70 %");
    expect(wrapper.get('[data-testid="agreement-confusion"]').findAll("td").map((c) => c.text())).toEqual(["20", "10", "5", "15"]);
    expect(wrapper.get('[data-testid="agreement-disagreements"]').text()).toContain("Item 3");
    expect(wrapper.find('[data-testid="agreement-low-sample"]').exists()).toBe(false);
  });

  it("says plainly that a small sample is noise", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric({ n: 5, lowSample: true })]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    expect(wrapper.get('[data-testid="agreement-low-sample"]').text()).toContain("Only 5 items");
  });

  it("explains an undefined kappa instead of showing NaN", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric({ kappa: null, kappaReason: "no_variance", percentAgreement: 1, disagreements: [] })]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    expect(wrapper.get('[data-testid="agreement-kappa"]').text()).toBe("–");
    expect(wrapper.text()).toContain("Kappa is undefined");
    expect(wrapper.text()).not.toContain("NaN");
  });

  it("shows no numbers for mixed judges or incomparable types, only the reason", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([
      metric({ name: "a", status: "mixed_judges", judge: null, judges: [{ model: "m1", promptHash: "h1" }, { model: "m2", promptHash: "h2" }], reason: "2 identities", kappa: null, confusion: undefined }),
      metric({ name: "b", status: "incomparable", reason: "judge boolean, human numeric", kappa: null, confusion: undefined }),
    ]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    const statuses = wrapper.findAll('[data-testid="agreement-status"]').map((s) => s.text());
    expect(statuses[0]).toContain("different judge versions");
    expect(statuses[1]).toContain("cannot be compared");
    expect(wrapper.find('[data-testid="agreement-kappa"]').exists()).toBe(false);
  });

  it("shows numeric metrics instead of kappa for a numeric evaluator", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric({ dataType: "numeric", kappa: null, confusion: undefined, binary: undefined, mae: 0.8, spearman: 0.55, pearson: 0.6, withinOne: 0.9, disagreements: [] })]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    expect(wrapper.find('[data-testid="agreement-kappa"]').exists()).toBe(false);
    const text = wrapper.text();
    expect(text).toContain("0.80");
    expect(text).toContain("Spearman");
    expect(text).toContain("90 %");
  });

  it("guides the user when nothing matches, and lists the unmatched names and skipped traces", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([], { unmatched: { judgeOnly: ["correctness"], humanOnly: ["tone"] }, scope: { type: "queue", id: "q-1", traceTargets: 2 } } as never);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { queueId: "q-1" } });
    expect(wrapper.get('[data-testid="agreement-empty"]').text()).toContain("same name");
    expect(wrapper.get('[data-testid="agreement-unmatched"]').text()).toContain("correctness");
    expect(wrapper.get('[data-testid="agreement-unmatched"]').text()).toContain("tone");
    expect(wrapper.get('[data-testid="agreement-trace-targets"]').text()).toContain("2 traces");
  });

  it("says how a queue's sample was built: representative only when fully random", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric()], { scope: { type: "queue", id: "q-1", traceTargets: 0, population: { manual: 0, filter: 0, randomSample: 40 } } } as never);
    const random = await setup(JudgeHumanAgreement, api, { scope: { queueId: "q-1" } });
    expect(random.wrapper.get('[data-testid="agreement-population"]').text()).toContain("40 randomly sampled");
    expect(random.wrapper.get('[data-testid="agreement-population"]').text()).toContain("representative");

    api.judgeHumanAgreement = agreementOf([metric()], { scope: { type: "queue", id: "q-1", traceTargets: 0, population: { manual: 10, filter: 0, randomSample: 30 } } } as never);
    const mixed = await setup(JudgeHumanAgreement, api, { scope: { queueId: "q-1" } });
    expect(mixed.wrapper.get('[data-testid="agreement-population"]').text()).toContain("Not a purely random sample");
  });

  it("emits the item index when a disagreement is clicked", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = agreementOf([metric()]);
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    await wrapper.get('[data-testid="agreement-disagreements"] button').trigger("click");
    expect(wrapper.findComponent(JudgeHumanAgreement).emitted("select-item")).toEqual([[3]]);
  });

  it("shows an error banner when the API fails", async () => {
    const api = new FakeTraceApi();
    api.judgeHumanAgreement = new ApiError(503, "Service Unavailable", "down");
    const { wrapper } = await setup(JudgeHumanAgreement, api, { scope: { datasetRunId: "run-1" } });
    expect(wrapper.find('[data-testid="agreement-metric"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("not responding");
  });
});

describe("InterAnnotatorAgreement (ADR-040)", () => {
  it("shows the mean kappa per rubric with reviewers and shared items", async () => {
    const api = new FakeTraceApi();
    api.interAnnotatorAgreement = { scope: { type: "queue", id: "q-1" }, metrics: [{ name: "correctness", dataType: "boolean", annotators: 3, n: 30, pairs: 3, meanPairwiseKappa: 0.62, lowSample: false }] };
    const { wrapper } = await setup(InterAnnotatorAgreement, api, { queueId: "q-1" });
    const row = wrapper.get('[data-testid="inter-annotator-row"]').text();
    expect(row).toContain("0.62");
    expect(row).toContain("substantial");
    expect(row).toContain("3 reviewers · 30 shared items");
    expect(row).not.toContain("low sample");
  });

  it("says when two reviewers have not overlapped yet and when there are no labels", async () => {
    const api = new FakeTraceApi();
    api.interAnnotatorAgreement = { scope: { type: "queue", id: "q-1" }, metrics: [{ name: "tone", dataType: "numeric", annotators: 2, n: 0, pairs: 0, meanPairwiseSpearman: null, lowSample: true }] };
    const { wrapper } = await setup(InterAnnotatorAgreement, api, { queueId: "q-1" });
    expect(wrapper.get('[data-testid="inter-annotator-row"]').text()).toContain("needs at least two reviewers on the same items");

    api.interAnnotatorAgreement = { scope: { type: "queue", id: "q-1" }, metrics: [] };
    const empty = await setup(InterAnnotatorAgreement, api, { queueId: "q-1" });
    expect(empty.wrapper.find('[data-testid="inter-annotator-empty"]').exists()).toBe(true);
  });
});

describe("DatasetRunDetailPage — agreement card", () => {
  const detail = () => ({
    dataset: { id: "ds-1", name: "toy" },
    run: datasetRunSummary({ aggregates: [] }),
    items: [datasetRunItem({ itemIndex: 0 }), datasetRunItem({ itemIndex: 1 })],
  });

  it("renders the card for this run and sends its items to a chosen queue", async () => {
    const api = new FakeTraceApi();
    api.datasetRunDetail = detail();
    api.judgeHumanAgreement = agreementOf([metric()]);
    api.queues = [queueSummary()];
    const { wrapper } = await setup(DatasetRunDetailPage, api);

    expect(api.judgeHumanCalls[0]!.scope).toEqual({ datasetRunId: "run-1" });
    expect(wrapper.find('[data-testid="judge-human-agreement"]').exists()).toBe(true);

    await wrapper.get('[data-testid="add-run-items-to-queue"]').trigger("click");
    await flushPromises();
    const radio = document.body.querySelector('input[name="queue"]') as HTMLInputElement;
    radio.click();
    await flushPromises();
    (document.body.querySelector("form button[type=submit]") as HTMLButtonElement).click();
    await flushPromises();

    // por defecto, una muestra aleatoria (nunca "los primeros N")
    expect(api.addedToQueue).toEqual([{ queueId: "q-1", body: { fromRun: { datasetRunId: "run-1", sample: { size: 3 } } } }]);
  });

  async function openQueuePicker(itemCount: number) {
    const api = new FakeTraceApi();
    api.datasetRunDetail = { ...detail(), run: datasetRunSummary({ aggregates: [], itemCount }) };
    api.judgeHumanAgreement = agreementOf([metric()]);
    api.queues = [queueSummary()];
    const { wrapper } = await setup(DatasetRunDetailPage, api);
    await wrapper.get('[data-testid="add-run-items-to-queue"]').trigger("click");
    await flushPromises();
    (document.body.querySelector('input[name="queue"]') as HTMLInputElement).click();
    await flushPromises();
    return api;
  }
  const submit = async () => {
    (document.body.querySelector("form button[type=submit]") as HTMLButtonElement).click();
    await flushPromises();
  };

  it("lets the user choose the sample size, and sends it to the server to draw (not the first N)", async () => {
    const api = await openQueuePicker(1000);
    const size = document.body.querySelector('[aria-label="Sample size"]') as HTMLInputElement;
    expect(size.value).toBe("50");
    size.value = "120";
    size.dispatchEvent(new Event("input"));
    await flushPromises();
    await submit();
    expect(api.addedToQueue[0]!.body).toEqual({ fromRun: { datasetRunId: "run-1", sample: { size: 120 } } });
  });

  it("can send every item of a small run, and forbids it for a run above the per-request cap", async () => {
    const small = await openQueuePicker(30);
    (document.body.querySelector('input[name="mode"][value="all"]') as HTMLInputElement).click();
    await flushPromises();
    await submit();
    expect(small.addedToQueue[0]!.body).toEqual({ fromRun: { datasetRunId: "run-1" } });
    document.body.innerHTML = "";

    await openQueuePicker(1000);
    expect((document.body.querySelector('input[name="mode"][value="all"]') as HTMLInputElement).disabled).toBe(true);
    expect(document.body.querySelector('[data-testid="run-selection"]')!.textContent).toContain("send a sample");
  });

  it("highlights the item row when a disagreement is selected", async () => {
    const api = new FakeTraceApi();
    api.datasetRunDetail = { ...detail(), items: [datasetRunItem({ itemIndex: 3 })] };
    api.judgeHumanAgreement = agreementOf([metric()]);
    const { wrapper } = await setup(DatasetRunDetailPage, api);
    Element.prototype.scrollIntoView = () => {};
    await wrapper.get('[data-testid="agreement-disagreements"] button').trigger("click");
    await flushPromises();
    expect(wrapper.get("#item-3").classes()).toContain("highlighted");
  });
});
