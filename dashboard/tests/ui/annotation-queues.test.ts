import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ApiError } from "@/application/trace-api";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import type { ExperimentDto } from "@/application/identity-api";
import AnnotationQueuesPage from "@/ui/pages/AnnotationQueuesPage.vue";
import AnnotationQueueReviewPage from "@/ui/pages/AnnotationQueueReviewPage.vue";
import { FakeIdentityApi, FakeTraceApi, node, queueDetail, queueItemDto, queueSummary, scoreConfigDto, traceDetail } from "../fakes";

async function setup(component: object, api: FakeTraceApi, path: string, props: Record<string, unknown> = {}, role: ExperimentDto["myRole"] = "admin", identity = new FakeIdentityApi()) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/annotation-queues", name: "annotation-queues", component: { template: "<div />" } },
      { path: "/e/:experimentId/annotation-queues/:queueId/review", name: "annotation-queue-review", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const experiment = computed(() => ({ id: "e1", myRole: role }) as ExperimentDto);
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: experiment } },
  });
  await flushPromises();
  return { wrapper, router };
}

const body = () => document.body;
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
    expect(row.text()).toContain("1/4");

    await row.findAll("button").find((b) => b.text() === "Review")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("annotation-queue-review");
    expect(router.currentRoute.value.params.queueId).toBe("q-1");
  });

  it("disables Review when nothing is pending", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary({ progress: { pending: 0, completed: 4, skipped: 0 } })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    expect(wrapper.findAll("button").find((b) => b.text() === "Review")!.attributes("disabled")).toBeDefined();
  });

  it("hides queue management from plain members but still lets them add traces", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, "member");
    expect(wrapper.find('[data-testid="new-queue"]').exists()).toBe(false);
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels).not.toContain("Archive");
    expect(labels).toContain("Add traces");
  });

  it("creates a queue with the chosen rubric", async () => {
    const api = new FakeTraceApi();
    const identity = new FakeIdentityApi();
    identity.scoreConfigs = [scoreConfigDto({ id: "cfg-1", name: "tone" }), scoreConfigDto({ id: "cfg-2", name: "helpful" })];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues", {}, "admin", identity);

    await wrapper.get('[data-testid="new-queue"]').trigger("click");
    await flushPromises();
    await setValue(body().querySelector('[aria-label="Queue name"]'), "Tone review");
    const checkboxes = [...body().querySelectorAll<HTMLInputElement>('.rubric input[type="checkbox"]')];
    await click(checkboxes[0]);
    await click([...body().querySelectorAll("button")].find((b) => b.textContent === "Create"));

    expect(api.createdQueues).toEqual([{ name: "Tone review", instructions: null, requiredAnnotations: 1, rubric: [{ configId: "cfg-1", required: true }] }]);
  });

  it("adds traces by filter as a bounded snapshot", async () => {
    const api = new FakeTraceApi();
    api.queues = [queueSummary()];
    const { wrapper } = await setup(AnnotationQueuesPage, api, "/e/e1/annotation-queues");
    await wrapper.findAll("button").find((b) => b.text() === "Add traces")!.trigger("click");
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
    await wrapper.findAll("button").find((b) => b.text() === "Add traces")!.trigger("click");
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
    await wrapper.findAll("button").find((b) => b.text() === "Details")!.trigger("click");
    await flushPromises();
    expect(body().querySelector('[data-testid="reviewer-row"]')!.textContent).toContain("Ana");
    expect(body().querySelector('[data-testid="queue-item-row"]')!.textContent).toContain("Trace");
    await click([...body().querySelectorAll("button")].find((b) => b.textContent === "Mark unreviewable"));
    expect(api.unreviewable).toEqual(["i1"]);
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
    expect(wrapper.find('[role="treeitem"]').text()).toContain("agent.run");
    expect(wrapper.get('[data-testid="rubric"]').text()).toContain("Be strict");
    expect(wrapper.get('[data-testid="rubric-config"]').text()).toContain("tone");
  });

  it("will not submit until every required label is filled, then sends them and pulls the next item", async () => {
    const { wrapper, api } = await open();
    const submit = wrapper.get('[data-testid="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.findAll(".choice-btn").find((b) => b.text() === "4")!.trigger("click");
    expect(submit.attributes("disabled")).toBeUndefined();
    await wrapper.get('input[aria-label="tone comment"]').setValue("good");
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
