import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { TRACE_API } from "@/dependency-container";
import TraceTimeline from "@/ui/components/TraceTimeline.vue";
import { FakeTraceApi, node, traceDetail } from "../../fakes";

let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

async function mountTimeline(api: FakeTraceApi) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/e/:experimentId/traces/:traceId", name: "trace", component: { template: "<div />" } }] });
  await router.push("/e/e1/traces/t1");
  mounted = mount(TraceTimeline, { props: { traceId: "t1" }, global: { plugins: [[Quasar, {}], router], provide: { [TRACE_API as symbol]: api } } });
  await flushPromises();
  return mounted;
}

const api = () => {
  const a = new FakeTraceApi();
  a.detail = traceDetail({
    durationMs: 1000,
    spanCount: 4,
    roots: [
      node({ spanId: "r", kind: "agent", durationMs: 1000, children: [
        node({ spanId: "g", name: "input_guardrail", offsetMs: 0, durationMs: 100, children: [node({ spanId: "c", name: "guardrail.regex_pii", offsetMs: 0, durationMs: 20 })] }),
        node({ spanId: "l", name: "chat", kind: "llm", offsetMs: 100, durationMs: 900 }),
      ] }),
    ],
  });
  return a;
};

describe("TraceTimeline", () => {
  it("starts as a single line of steps and expands into the rows", async () => {
    const w = await mountTimeline(api());
    expect(w.find('[data-testid="timeline-line"]').exists()).toBe(true);
    expect(w.find('[data-testid="timeline-rows"]').exists()).toBe(false);
    await w.find('[data-testid="timeline-toggle"]').trigger("click");
    expect(w.find('[data-testid="timeline-line"]').exists()).toBe(false);
    expect(w.find('[data-testid="timeline-rows"]').text()).toContain("regex_pii");
    await w.find('[data-testid="timeline-toggle"]').trigger("click");
    expect(w.find('[data-testid="timeline-line"]').exists()).toBe(true);
  });

  it("renders nothing when the trace cannot be loaded", async () => {
    const failing = new FakeTraceApi();
    failing.detail = new Error("boom");
    const w = await mountTimeline(failing);
    expect(w.find('[data-testid="trace-timeline"]').exists()).toBe(false);
  });
});
