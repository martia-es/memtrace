import { describe, expect, it } from "vitest";
import { describePopulation, formatKappa, formatRate, itemIndexOfTarget, kappaLabel, kappaNote, kappaTone, lowSampleNote } from "@/domain/agreement";

describe("agreement presentation (ADR-040)", () => {
  it("reads kappa on the Landis–Koch scale", () => {
    expect(kappaLabel(null)).toBe("n/a");
    expect(kappaLabel(-0.1)).toBe("worse than chance");
    expect(kappaLabel(0.1)).toBe("slight");
    expect(kappaLabel(0.4)).toBe("fair");
    expect(kappaLabel(0.5)).toBe("moderate");
    expect(kappaLabel(0.7)).toBe("substantial");
    expect(kappaLabel(0.9)).toBe("almost perfect");
  });

  it("tones kappa so a weak judge stands out", () => {
    expect(kappaTone(null)).toBe("default");
    expect(kappaTone(0.7)).toBe("positive");
    expect(kappaTone(0.5)).toBe("warning");
    expect(kappaTone(0.2)).toBe("negative");
  });

  it("formats missing values as a dash, never NaN", () => {
    expect(formatKappa(null)).toBe("–");
    expect(formatKappa(undefined)).toBe("–");
    expect(formatKappa(0.456)).toBe("0.46");
    expect(formatRate(null)).toBe("–");
    expect(formatRate(0.7)).toBe("70 %");
  });

  it("explains a missing kappa only when the cause is no variance", () => {
    expect(kappaNote({ kappa: 0.5 })).toBeNull();
    expect(kappaNote({ kappa: null, kappaReason: "no_variance" })).toContain("undefined");
    expect(kappaNote({ kappa: null })).toBeNull();
  });

  it("warns about a small sample with the item count", () => {
    expect(lowSampleNote(1)).toContain("Only 1 item ");
    expect(lowSampleNote(5)).toContain("Only 5 items");
  });

  it("describes how a queue sample was built and warns when it is not purely random", () => {
    expect(describePopulation({ manual: 0, filter: 0, randomSample: 0 })).toBeNull();
    expect(describePopulation({ manual: 0, filter: 0, randomSample: 40 })).toMatchObject({ tone: "ok", text: expect.stringContaining("40 randomly sampled") });
    const mixed = describePopulation({ manual: 5, filter: 3, randomSample: 2 })!;
    expect(mixed.tone).toBe("warn");
    expect(mixed.text).toContain("3 chosen by a filter or whole run");
    expect(mixed.text).toContain("5 picked by hand");
    expect(describePopulation({ manual: 4, filter: 0, randomSample: 0 })!.tone).toBe("warn");
  });

  it("maps a disagreement target back to an item index of this run only", () => {
    expect(itemIndexOfTarget("run:r1:7", "r1")).toBe(7);
    expect(itemIndexOfTarget("run:r2:7", "r1")).toBeNull();
    expect(itemIndexOfTarget("trace:abc", "r1")).toBeNull();
    expect(itemIndexOfTarget("run:r1:x", "r1")).toBeNull();
  });
});
