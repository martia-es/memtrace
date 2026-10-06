import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import type { SpanNodeDto } from "@contract";
import { TRACE_API } from "@/dependency-container";
import AddToDatasetModal from "@/ui/components/AddToDatasetModal.vue";
import { datasetDto, FakeTraceApi, node } from "../../fakes";
import { chooseOption } from "../select";

// `Modal` se teletransporta a <body>: se consulta el documento, no el wrapper.
const $ = <T extends Element>(testId: string) => document.body.querySelector(`[data-testid="${testId}"]`) as T | null;
const text = (testId: string) => $(testId)!.textContent ?? "";

async function set(testId: string, value: string) {
  const el = $<HTMLInputElement | HTMLTextAreaElement>(testId)!;
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
}

const pickDataset = (label = "toy-agent-smoke-test") => chooseOption(document.body, '[data-testid="dataset-select"]', label);

async function submit() {
  document.body.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await flushPromises();
}

let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

async function mountModal(roots: SpanNodeDto[], datasets = [datasetDto()]) {
  const trace = new FakeTraceApi();
  trace.datasets = { items: datasets };
  mounted = mount(AddToDatasetModal, {
    props: { traceId: "t1", roots },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [TRACE_API as symbol]: trace } },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper: mounted, trace };
}

const withContent = [node({ content: { input: "capital of France?", output: "Lyon" } })];

describe("AddToDatasetModal", () => {
  it("prefills the input from the trace and shows what the agent answered as context only", async () => {
    await mountModal(withContent);
    expect($<HTMLTextAreaElement>("input")!.value).toBe("capital of France?");
    expect($<HTMLTextAreaElement>("expected")!.value).toBe("");
    expect(document.body.textContent).toContain("Lyon");
    expect(text("no-expected")).toContain("LLM-as-judge");
  });

  it("sends the edited input and the expected output parsed as JSON-or-text, in one call", async () => {
    const { trace } = await mountModal(withContent);
    await pickDataset();
    await set("input", '{"q":"capital of [country]?"}');
    await set("expected", "Paris");
    await submit();
    expect(trace.promoteCalls).toEqual([{ datasetId: "ds-1", body: { items: [{ traceId: "t1", input: { q: "capital of [country]?" }, expectedOutput: "Paris" }] } }]);
  });

  it("omits expectedOutput when left blank", async () => {
    const { trace } = await mountModal(withContent);
    await pickDataset();
    await submit();
    expect(trace.promoteCalls[0]!.body.items[0]).toEqual({ traceId: "t1", input: "capital of France?" });
  });

  it("warns and blocks saving when the trace has no input until one is typed", async () => {
    await mountModal([node({ content: null })]);
    expect($("no-content")).not.toBeNull();
    await pickDataset();
    expect($<HTMLButtonElement>("save")!.disabled).toBe(true);
    await set("input", "typed input");
    expect($<HTMLButtonElement>("save")!.disabled).toBe(false);
  });

  it("explains when there are no datasets", async () => {
    await mountModal(withContent, []);
    expect($("no-datasets")).not.toBeNull();
  });

  it("stays open when the server skips the trace", async () => {
    const { wrapper, trace } = await mountModal(withContent);
    trace.promoteResult = { added: [], skipped: [{ traceId: "t1", reason: "already_promoted" }], version: null };
    await pickDataset();
    await submit();
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("closes after a successful promotion", async () => {
    const { wrapper, trace } = await mountModal(withContent);
    trace.promoteResult = { added: [], skipped: [], version: { major: 2, minor: 0 } as never };
    await pickDataset();
    await submit();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
