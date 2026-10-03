import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import type { QueueItemDto } from "@contract";
import { TRACE_API } from "@/dependency-container";
import PromoteQueueToDataset from "@/ui/components/PromoteQueueToDataset.vue";
import { datasetDto, FakeTraceApi, scoreConfigDto } from "../../fakes";

const item = (traceId: string, status: QueueItemDto["status"] = "completed"): QueueItemDto => ({ id: traceId, targetType: "trace", traceId, datasetRunId: null, itemIndex: null, status, population: "manual", addedAt: "", completedAt: null });

let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

async function mountIt(items: QueueItemDto[]) {
  const trace = new FakeTraceApi();
  trace.datasets = { items: [datasetDto()] };
  mounted = mount(PromoteQueueToDataset, {
    props: { items, configs: [scoreConfigDto({ id: "cfg", name: "correct_answer", dataType: "categorical" }), scoreConfigDto({ id: "num", name: "score", dataType: "numeric" })] },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [TRACE_API as symbol]: trace } },
  });
  await flushPromises();
  return { wrapper: mounted, trace };
}

describe("PromoteQueueToDataset", () => {
  it("explains when nothing is reviewed yet", async () => {
    const { wrapper } = await mountIt([item("a", "pending")]);
    expect(wrapper.find('[data-testid="promote-empty"]').exists()).toBe(true);
  });

  it("promotes reviewed traces in one call with the chosen categorical config", async () => {
    const { wrapper, trace } = await mountIt([item("a"), item("b"), item("c", "pending")]);
    await wrapper.get('[data-testid="promote-dataset"]').setValue("ds-1");
    expect(wrapper.findAll('[data-testid="promote-config"] option').map((o) => o.text())).toEqual(["No expected output", "Expected output from “correct_answer”"]);
    await wrapper.get('[data-testid="promote-config"]').setValue("cfg");
    await wrapper.get('[data-testid="promote-run"]').trigger("click");
    await flushPromises();
    expect(trace.promoteCalls).toEqual([{ datasetId: "ds-1", body: { items: [{ traceId: "a", fromConfigId: "cfg" }, { traceId: "b", fromConfigId: "cfg" }] } }]);
  });

  it("needs a dataset before promoting", async () => {
    const { wrapper } = await mountIt([item("a")]);
    expect((wrapper.get('[data-testid="promote-run"]').element as HTMLButtonElement).disabled).toBe(true);
  });
});
