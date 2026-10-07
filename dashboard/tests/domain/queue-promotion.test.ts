import { describe, expect, it } from "vitest";
import type { QueueResultCriterionDto, QueueResultItemDto } from "@contract";
import { countSkipReasons, expectedOutputFor, finalValue, promotionBatches, rowReadiness } from "@/domain/queue-promotion";
import { queueResultItem } from "../fakes";

const label = (userId: string, value: string) => ({ userId, name: userId, value, comment: null, createdAt: "", isReviewer: true });
const criterion = (o: Partial<QueueResultCriterionDto> = {}): QueueResultCriterionDto => ({ configId: "c1", status: "consensus", labels: [label("a", "good"), label("b", "good")], resolution: null, ...o });
const row = (o: Partial<QueueResultItemDto> = {}) => queueResultItem({ traceId: "t1", criteria: [criterion()], ...o });
const categorical = { id: "c1", dataType: "categorical" as const };

describe("queue promotion from Results (ADR-050)", () => {
  it("only lets completed trace rows without an open disagreement through", () => {
    expect(rowReadiness(row())).toBe("ready");
    expect(rowReadiness(row({ status: "pending" }))).toBe("not_reviewed");
    expect(rowReadiness(row({ needsResolution: true }))).toBe("needs_resolution");
    expect(rowReadiness(row({ targetType: "run_item", traceId: null }))).toBe("not_a_trace");
  });

  it("takes the resolution first, then the consensus; never guesses on a disagreement", () => {
    const split = criterion({ status: "disagreement", labels: [label("a", "good"), label("b", "bad")] });
    expect(finalValue(row({ criteria: [split] }), "c1")).toBeNull();
    expect(finalValue(row({ criteria: [{ ...split, resolution: { value: "bad", expectedOutput: null, resolvedBy: "u", resolvedAt: "" } }] }), "c1")).toBe("bad");
    expect(finalValue(row(), "c1")).toBe("good");
    expect(finalValue(row({ criteria: [criterion({ labels: [label("a", "4"), label("b", "5"), label("c", "5")] })] }), "c1", { dataType: "numeric" })).toBe("5");
  });

  it("copies the technician's typed answer, else the reference label, else nothing", () => {
    const typed = row({ criteria: [criterion({ resolution: { value: "good", expectedOutput: "Hoy no llueve", resolvedBy: "u", resolvedAt: "" } })] });
    expect(expectedOutputFor(typed, categorical)).toBe("Hoy no llueve");
    expect(expectedOutputFor(row(), categorical)).toBe("good");
    expect(expectedOutputFor(row())).toBeUndefined();
    expect(expectedOutputFor(row(), { id: "c1", dataType: "numeric" })).toBeUndefined();
  });

  it("asks for the reviewed reply only on rows without a typed answer", () => {
    const typed = row({ id: "a", traceId: "a", criteria: [criterion({ resolution: { value: "good", expectedOutput: "Hoy no llueve", resolvedBy: "u", resolvedAt: "" } })] });
    const plain = row({ id: "b", traceId: "b" });
    const [batch] = promotionBatches([typed, plain], categorical, "q1", true);
    expect(batch!.items).toEqual([
      { traceId: "a", expectedOutput: "Hoy no llueve", queueId: "q1" },
      { traceId: "b", useObservedOutput: true, queueId: "q1" },
    ]);
  });

  it("promotes only ready rows, once per trace, in batches of 100 with the expected output", () => {
    const rows = Array.from({ length: 250 }, (_, i) => row({ id: `i${i}`, traceId: `t${i}` }));
    const batches = promotionBatches([...rows, row({ id: "dup", traceId: "t0" }), row({ id: "p", traceId: "p", status: "pending" }), row({ id: "d", traceId: "d", needsResolution: true })], categorical);
    expect(batches.map((b) => b.items.length)).toEqual([100, 100, 50]);
    expect(batches[0]!.items[0]).toEqual({ traceId: "t0", expectedOutput: "good" });
    expect(promotionBatches([row()])[0]!.items[0]).toEqual({ traceId: "t1" });
    expect(promotionBatches([row({ status: "pending" })])).toEqual([]);
  });

  it("counts skip reasons", () => {
    expect(countSkipReasons([{ reason: "no_content" }, { reason: "no_content" }, { reason: "not_found" }])).toEqual({ no_content: 2, not_found: 1 });
  });
});
