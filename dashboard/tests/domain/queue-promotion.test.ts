import { describe, expect, it } from "vitest";
import type { QueueItemDto } from "@contract";
import { countSkipReasons, promotableTraceIds, promotionBatches } from "@/domain/queue-promotion";

const item = (o: Partial<QueueItemDto>): QueueItemDto => ({ id: "i", targetType: "trace", traceId: "t1", datasetRunId: null, itemIndex: null, status: "completed", population: "manual", addedAt: "", completedAt: null, ...o });

describe("queue promotion", () => {
  it("only takes completed trace items, once each", () => {
    const ids = promotableTraceIds([item({ traceId: "a" }), item({ traceId: "a" }), item({ traceId: "b", status: "pending" }), item({ traceId: "c", status: "skipped" }), item({ targetType: "run_item", traceId: null })]);
    expect(ids).toEqual(["a"]);
  });

  it("splits into batches of 100 and forwards the label config", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const batches = promotionBatches(ids, "cfg");
    expect(batches.map((b) => b.items.length)).toEqual([100, 100, 50]);
    expect(batches[0]!.items[0]).toEqual({ traceId: "t0", fromConfigId: "cfg" });
    expect(promotionBatches(["x"])[0]!.items[0]).toEqual({ traceId: "x" });
  });

  it("counts skip reasons", () => {
    expect(countSkipReasons([{ reason: "no_content" }, { reason: "no_content" }, { reason: "not_found" }])).toEqual({ no_content: 2, not_found: 1 });
  });
});
