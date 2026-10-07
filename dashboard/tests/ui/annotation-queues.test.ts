import { permissionsOf } from "../permissions";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import type { ExperimentDto } from "@/application/identity-api";
import AnnotationQueuesPage from "@/ui/pages/AnnotationQueuesPage.vue";
import AnnotationQueueReviewPage from "@/ui/pages/AnnotationQueueReviewPage.vue";
import { chooseOption } from "./select";
import { FakeIdentityApi, FakeTraceApi, node, queueDetail, queueItemDto, queueResultItem, queueSummary, scoreConfigDto, traceDetail } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}, role: ExperimentDto["myRole"] = "technical", identity = new FakeIdentityApi()) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/annotation-queues", name: "annotation-queues", component: { template: "<div />" } },
      { path: "/e/:experimentId/annotation-queues/all", name: "annotation-queues-all", component: { template: "<div />" }, meta: { view: "active" } },
      { path: "/e/:experimentId/annotation-queues/archived", name: "annotation-queues-archived", component: { template: "<div />" }, meta: { view: "archived" } },
      { path: "/e/:experimentId/inbox", name: "inbox", component: { template: "<div />" }, meta: { view: "assigned" } },
      { path: "/e/:experimentId/annotation-queues/:queueId/review", name: "annotation-queue-review", component: { template: "<div />" } },
      { path: "/e/:experimentId/traces/:traceId", name: "trace", component: { template: "<div />" } },
      { path: "/datasets/:datasetId", name: "dataset", component: { template: "<div />" } },
      { path: "/datasets/:datasetId/runs/:runId", name: "dataset-run", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const experiment = computed(() => ({ id: "e1", myRole: role, permissions: permissionsOf(role) }) as ExperimentDto);
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: experiment } },
  });
  await flushPromises();
  return { wrapper, router };
}

const body = () => document.body;
// las acciones secundarias de cada fila viven en el menú ⋯
const menuAction = async (wrapper: { get: (sel: string) => { trigger: (e: string) => Promise<unknown> } }, label: string) => {
  await wrapper.get('[data-testid="queue-more"]').trigger("click");
  await flushPromises();
  await click([...body().querySelectorAll(".menu-list button")].reverse().find((b) => b.textContent === label));
};
const menuLabels = async (wrapper: { get: (sel: string) => { trigger: (e: string) => Promise<unknown> } }) => {
  await wrapper.get('[data-testid="queue-more"]').trigger("click");
  await flushPromises();
  const menus = body().querySelectorAll(".menu-list");
  return [...menus[menus.length - 1]!.querySelectorAll("button")].map((b) => b.textContent);
};
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  (el as HTMLElement).click();
  await flushPromises();
};
const setValue = async (el: Element | null, value: string) => {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
};

describe("AnnotationQueuesPage", () => {
  it("lists queues with their progress and starts a review", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper, router } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    const row = wrapper.get('[data-testid="queue-row"]');
    expect(row.text()).toContain("Chatbot answers");
    expect(row.text()).toContain("1 of 4");
    expect(row.text()).toContain("3 pending");

    await row.findAll("button").find((b) => b.text() === "Review")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("annotation-queue-review");
    expect(router.currentRoute.value.params.queueId).toBe("q-1");
  });

  it("shows the queues of the page the route points to (inbox, all queues, archived), with no tab bar", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ id: "q-mine", name: "Mine", isReviewer: true }), queueSummary({ id: "q-other", name: "Other", isReviewer: false }), queueSummary({ id: "q-old", name: "Old", archivedAt: "2026-01-01T00:00:00Z" })];
    const names = (w: { findAll: (s: string) => { text: () => string }[] }) => w.findAll('[data-testid="queue-row"]').map((r) => r.text());

    const inbox = await setup(AnnotationQueuesPage, api, "/e/e1/inbox");
    expect(names(inbox.wrapper)).toHaveLength(1);
    expect(names(inbox.wrapper)[0]).toContain("Mine");
    expect(inbox.wrapper.find('[role="tablist"]').exists()).toBe(false);
    inbox.wrapper.unmount();

    const all = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues/all");
    expect(names(all.wrapper)).toHaveLength(2);
    all.wrapper.unmount();

    const archived = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues/archived");
    expect(names(archived.wrapper)).toHaveLength(1);
    expect(names(archived.wrapper)[0]).toContain("Old");
  });

  it("shows each reviewer's photo, or their initials, labelled with their name (shown as a tooltip on hover)", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ assignedReviewers: [{ userId: "u-1", name: "Ana García", image: "https://img/ana.png" }, { userId: "u-2", name: "Luis Pérez", image: null }] })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    const avatars = wrapper.findAll('[data-testid="queue-reviewer"]');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]!.find("img").attributes("src")).toBe("https://img/ana.png");
    expect(avatars[1]!.text()).toContain("LP");
    expect(avatars.map((a) => a.attributes("aria-label"))).toEqual(["Ana García", "Luis Pérez"]);
  });

  it("does not offer Review (nor count its pending items) for a queue where I am not a reviewer", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ isReviewer: false })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    expect(wrapper.findAll("button").some((b) => b.text() === "Review")).toBe(false);
    expect(wrapper.findAll("button").some((b) => b.text() === "View results")).toBe(true);
  });

  it("does not show curation work to people who only review", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ toCurate: 3 })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, "business");
    expect(wrapper.find("[data-testid=curate-inbox]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=queue-to-curate]").exists()).toBe(false);
  });

  it("offers View results instead of Review when nothing is pending", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ progress: { pending: 0, completed: 4, skipped: 0 } })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    expect(wrapper.findAll("button").some((b) => b.text() === "Review")).toBe(false);
    expect(wrapper.findAll("button").some((b) => b.text() === "View results")).toBe(true);
  });

  it("hides queue management from plain members but still lets them add traces", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, "business");
    expect(wrapper.find('[data-testid="new-queue"]').exists()).toBe(false);
    const labels = await menuLabels(wrapper);
    expect(labels).not.toContain("Archive");
    expect(labels).toContain("Add traces");
  });

  it("creates a queue with the chosen rubric", async () => {
    const api = new FakeTraceApi();
    const identity = new FakeIdentityApi();
    identity.scoreConfigs = [scoreConfigDto({ id: "cfg-1", name: "tone" }), scoreConfigDto({ id: "cfg-2", name: "helpful" })];
    api.reviewerCandidates = [
      { userId: "u-ana", email: "ana@acme.com", name: "Ana" },
      { userId: "u-luis", email: "luis@acme.com", name: "Luis" },
    ];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, "technical", identity);

    await wrapper.get('[data-testid="new-queue"]').trigger("click");
    await flushPromises();
    await setValue(body().querySelector('[aria-label="Queue name"]'), "Tone review");
    const checkboxes = [...body().querySelectorAll<HTMLInputElement>('.rubric input[type="checkbox"]')];
    const create = () => [...body().querySelectorAll("button")].find((b) => b.textContent === "Create") as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    await click(checkboxes[2]); // primera config de la rúbrica (las dos primeras casillas son los miembros)
    expect(create().disabled).toBe(true); // sin revisores no se puede crear
    await click(checkboxes[1]); // Luis
    await click(create());

    expect(api.createdQueues).toEqual([{ name: "Tone review", instructions: null, requiredAnnotations: 1, reviewerIds: ["u-luis"], rubric: [{ configId: "cfg-1", required: true }] }]);
  });

  it("adds traces by filter as a bounded snapshot", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    await menuAction(wrapper, "Add traces");
    await flushPromises();
    await click(body().querySelector('input[type="checkbox"]'));
    await click(body().querySelector(".modal-form button[type=submit]"));

    expect(api.addedToQueue).toHaveLength(1);
    expect(api.addedToQueue[0]!.queueId).toBe("q-1");
    expect(api.addedToQueue[0]!.body).toMatchObject({ fromFilter: { hasErrors: true, limit: 100 } });
  });

  it("can pick the traces at random from all matches instead of the first ones", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    await menuAction(wrapper, "Add traces");
    await flushPromises();
    await click(body().querySelector('[aria-label="Random sample"]'));
    await setValue(body().querySelector('[aria-label="Limit"]'), "30");
    await click(body().querySelector(".modal-form button[type=submit]"));

    const sent = api.addedToQueue[0]!.body as { fromFilter: Record<string, unknown> };
    expect(sent.fromFilter.sample).toEqual({ size: 30 });
    expect(sent.fromFilter).not.toHaveProperty("limit");
  });

  it("opens the details with progress, reviewers and the items, and lets admins retire an item", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    api.queueDetail = queueDetail({ reviewers: [{ userId: "u1", name: "Ana", completed: 2, skipped: 1, inProgress: 0 }] });
    api.queueItems = [queueItemDto({ id: "i1" })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    await menuAction(wrapper, "Details");
    await flushPromises();
    expect(body().querySelector('[data-testid="reviewer-row"]')!.textContent).toContain("Ana");
    await click(body().querySelector('[data-testid="tab-settings"]'));
    expect(body().querySelector('[data-testid="queue-item-row"]')!.textContent).toContain("Trace");
    await click([...body().querySelectorAll("button")].find((b) => b.textContent === "Mark unreviewable"));
    expect(api.unreviewable).toEqual(["i1"]);
  });
});

describe("Queue results (ADR-050)", () => {
  // los modales de pruebas anteriores siguen en el body: sin esto `querySelector` encontraría los viejos
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const cfg = scoreConfigDto({ id: "cfg-1", name: "correct", dataType: "categorical", minValue: null, maxValue: null, categories: [{ label: "good", value: null }, { label: "bad", value: null }] });
  const label = (userId: string, name: string, value: string, comment: string | null = null) => ({ userId, name, value, comment, createdAt: "", isReviewer: true });
  const agreed = queueResultItem({ id: "i1", traceId: "trace-ok", criteria: [{ configId: "cfg-1", status: "consensus", labels: [label("a", "Ana", "good"), label("b", "Luis", "good")], resolution: null }] });
  const split = queueResultItem({
    id: "i2",
    traceId: "trace-split",
    needsResolution: true,
    criteria: [{ configId: "cfg-1", status: "disagreement", labels: [label("a", "Ana", "good", "looks right"), label("b", "Luis", "bad", "wrong hour")], resolution: null }],
  });

  async function openResults(role: ExperimentDto["myRole"] = "technical") {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    api.queueDetail = queueDetail({ configs: [cfg] });
    api.queueResults = { configs: [cfg], total: 2, items: [agreed, split] };
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, role);
    await menuAction(wrapper, "Details");
    await flushPromises();
    return api;
  }

  it("tells the technical profile which reviewed items wait for their decision, and opens Results directly", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ progress: { pending: 0, completed: 4, skipped: 0 }, toCurate: 3 })];
    api.queueDetail = queueDetail({ configs: [cfg] });
    api.queueResults = { configs: [cfg], total: 0, items: [] };
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    expect(wrapper.get("[data-testid=curate-inbox]").text()).toContain("3 reviewed items are waiting for your decision");
    expect(wrapper.get("[data-testid=queue-to-curate]").text()).toContain("3 to review");
    await wrapper.get("[data-testid=open-results]").trigger("click");
    await flushPromises();
    expect(body().querySelector('[data-testid="queue-results"]')).not.toBeNull();
  });

  it("shows each reviewer's answer per item and flags the disagreement", async () => {
    await openResults();
    await click(body().querySelector('[data-testid="tab-results"]'));
    const rows = [...body().querySelectorAll('[data-testid="result-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Ana: good");
    expect(rows[1]!.textContent).toContain("Luis: bad");
    expect(rows[1]!.textContent).toContain("disagreement");
  });

  it("does not offer Results to people who only review", async () => {
    await openResults("business");
    expect(body().querySelector('[data-testid="tab-results"]')).toBeNull();
    expect(body().querySelector('[data-testid="queue-results"]')).toBeNull();
  });

  it("saves the technician's decision apart from the labels", async () => {
    const api = await openResults();
    await click(body().querySelector('[data-testid="tab-results"]'));
    await click([...body().querySelectorAll('[data-testid="resolve-btn"]')][1]);
    await click([...body().querySelectorAll('[data-testid="choice"]')].find((b) => b.textContent === "bad"));
    await setValue(body().querySelector('textarea[aria-label="Correct answer"]'), "Mañana a las 18h");
    await click(body().querySelector('[data-testid="save-resolution"]'));
    expect(api.resolutions).toEqual([{ queueId: "q-1", itemId: "i2", configId: "cfg-1", body: { value: "bad", expectedOutput: "Mañana a las 18h" } }]);
  });

  it("only lets resolved or agreed rows be selected, and promotes just those with the typed answer", async () => {
    const api = await openResults();
    const promoted: unknown[] = [];
    api.promoteTracesToDataset = async (_datasetId, bodyArg) => {
      promoted.push(bodyArg);
      return { added: bodyArg.items.map(() => ({}) as never), skipped: [], version: null } as never;
    };
    api.datasets = { items: [{ id: "d1", name: "Regression" }] } as never;
    await click(body().querySelector('[data-testid="tab-results"]'));
    const boxes = [...body().querySelectorAll<HTMLInputElement>('[data-testid="result-select"]')];
    expect(boxes.map((b) => b.disabled)).toEqual([false, true]);
    await click(body().querySelector('[data-testid="select-ready"]'));
    await chooseOption(body(), '[data-testid="promote-dataset"]', "Regression");
    await chooseOption(body(), '[data-testid="promote-config"]', "Expected output: the label of “correct” (unless I typed one)");
    await flushPromises();
    await click(body().querySelector('[data-testid="promote-run"]'));
    expect(promoted).toEqual([{ items: [{ traceId: "trace-ok", expectedOutput: "good", queueId: "q-1" }] }]);
  });

  it("can ask for the reviewed reply as the expected output of rows without a typed answer", async () => {
    const api = await openResults();
    const promoted: unknown[] = [];
    api.promoteTracesToDataset = async (_datasetId, bodyArg) => {
      promoted.push(bodyArg);
      return { added: bodyArg.items.map(() => ({}) as never), skipped: [], version: null } as never;
    };
    api.datasets = { items: [{ id: "d1", name: "Regression" }] } as never;
    await click(body().querySelector('[data-testid="tab-results"]'));
    await click(body().querySelector('[data-testid="select-ready"]'));
    await chooseOption(body(), '[data-testid="promote-dataset"]', "Regression");
    await chooseOption(body(), '[data-testid="promote-config"]', "Expected output: the reply that was reviewed (unless I typed one)");
    await flushPromises();
    await click(body().querySelector('[data-testid="promote-run"]'));
    expect(promoted).toEqual([{ items: [{ traceId: "trace-ok", useObservedOutput: true, queueId: "q-1" }] }]);
  });

  it("links each row to the dataset that already holds an item promoted from it", async () => {
    const api = await openResults();
    api.queueResults = { ...api.queueResults, items: [queueResultItem({ ...agreed, promotedTo: [{ datasetId: "d1", datasetName: "Regression", version: "3.0" }] }), split] };
    await click(body().querySelector('[data-testid="tab-summary"]'));
    await click(body().querySelector('[data-testid="tab-results"]'));
    const badges = [...body().querySelectorAll('[data-testid="promoted-to"]')];
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toContain("Regression v3.0");
  });

  it("filters to disagreements", async () => {
    await openResults();
    await click(body().querySelector('[data-testid="tab-results"]'));
    await click(body().querySelector('[data-testid="only-disagreements"]'));
    expect(body().querySelector('[data-testid="queue-results"]')).not.toBeNull();
  });
});

describe("AnnotationQueueReviewPage", () => {
  const open = (tweak: (api: FakeTraceApi) => void = () => {}) => {
    const api = new FakeTraceApi();
    api.queueDetail = queueDetail({ instructions: "Be strict" });
    api.detail = traceDetail({ roots: [node({ spanId: "r", name: "agent.run" })] });
    api.nextItems = [queueItemDto({ id: "i1" }), queueItemDto({ id: "i2", traceId: "trace-def" })];
    tweak(api);
    return setup(AnnotationQueueReviewPage, api, "/e/e1/annotation-queues/q-1/review", { queueId: "q-1" }).then((r) => ({ api, ...r }));
  };

  it("shows the trace next to the rubric and instructions", async () => {
    const { wrapper } = await open();
    expect(wrapper.find('[data-testid="thread"]').exists()).toBe(true);
    expect(wrapper.find('[role="treeitem"]').exists()).toBe(false);
    await wrapper.get('[data-testid="trace-toggle"]').trigger("click");
    expect(wrapper.find('[role="treeitem"]').text()).toContain("agent.run");
    expect(wrapper.get('[data-testid="rubric"]').text()).toContain("Be strict");
    expect(wrapper.get('[data-testid="rubric-config"]').text()).toContain("tone");
  });

  it("will not submit until every required label is filled, then sends them and pulls the next item", async () => {
    const { wrapper, api } = await open();
    const submit = wrapper.get('[data-testid="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.findAll(".choice").find((b) => b.text().startsWith("4"))!.trigger("click");
    expect(submit.attributes("disabled")).toBeUndefined();
    await wrapper.findAll("button").find((b) => b.text() === "+ Add note")!.trigger("click");
    await wrapper.get('textarea[aria-label="tone note"]').setValue("good");
    await submit.trigger("click");
    await flushPromises();

    expect(api.completed).toEqual([{ queueId: "q-1", itemId: "i1", labels: [{ configId: "cfg-1", value: "4", comment: "good" }] }]);
    // the form starts clean for the next item
    expect(wrapper.get('[data-testid="submit"]').attributes("disabled")).toBeDefined();
    expect(api.nextItems).toHaveLength(0);
  });

  it("skips an item without sending labels", async () => {
    const { wrapper, api } = await open();
    await wrapper.get('[data-testid="skip"]').trigger("click");
    await flushPromises();
    expect(api.skipped).toEqual(["i1"]);
    expect(api.completed).toEqual([]);
  });

  it("marks an item as unreviewable directly from the review page", async () => {
    const { wrapper, api } = await open();
    await wrapper.get('[data-testid="mark-unreviewable"]').trigger("click");
    await flushPromises();
    expect(api.unreviewable).toEqual(["i1"]);
    expect(api.completed).toEqual([]);
  });

  it("says so when the queue has nothing left", async () => {
    const { wrapper } = await open((api) => (api.nextItems = []));
    expect(wrapper.text()).toContain("Nothing left to review here");
  });

  it("explains a trace that no longer exists and still lets the reviewer skip it", async () => {
    const { wrapper } = await open((api) => (api.detail = new ApiError(404, "Not Found")));
    expect(wrapper.get('[data-testid="trace-gone"]').text()).toContain("no longer available");
    expect(wrapper.get('[data-testid="skip"]').attributes("disabled")).toBeUndefined();
  });

  it("does not offer archived configs of the rubric", async () => {
    const { wrapper } = await open((api) => (api.queueDetail = queueDetail({ configs: [scoreConfigDto({ archivedAt: "2026-10-01T00:00:00Z" })] })));
    expect(wrapper.findAll('[data-testid="rubric-config"]')).toHaveLength(0);
    expect(wrapper.get('[data-testid="submit"]').attributes("disabled")).toBeUndefined();
  });
});
