import { describe, expect, it } from "vitest";
import { criterionStatus, effectiveValue, hasDisagreement, type ResultLabel } from "@/domain/queue-results";

const label = (userId: string, value: string): ResultLabel => ({ userId, value, comment: null, createdAt: "2026-10-04T00:00:00.000Z" });

describe("queue results (ADR-050)", () => {
  it("has no disagreement with fewer than two labels", () => {
    expect(hasDisagreement("categorical", [])).toBe(false);
    expect(hasDisagreement("categorical", ["good"])).toBe(false);
  });

  it("flags different categorical and boolean values", () => {
    expect(hasDisagreement("categorical", ["good", "bad"])).toBe(true);
    expect(hasDisagreement("boolean", ["true", "true"])).toBe(false);
    expect(hasDisagreement("boolean", ["true", "false"])).toBe(true);
  });

  it("flags numeric labels only when they differ by more than 1 (same rule as ADR-040)", () => {
    expect(hasDisagreement("numeric", ["4", "5"])).toBe(false);
    expect(hasDisagreement("numeric", ["2", "4"])).toBe(true);
  });

  it("classifies a criterion", () => {
    expect(criterionStatus("boolean", [])).toBe("no_labels");
    expect(criterionStatus("boolean", [label("a", "true"), label("b", "true")])).toBe("consensus");
    expect(criterionStatus("boolean", [label("a", "true"), label("b", "false")])).toBe("disagreement");
  });

  it("prefers the technician's resolution, then consensus, and never guesses on an open disagreement", () => {
    const split = [label("a", "true"), label("b", "false")];
    expect(effectiveValue("boolean", split, { value: "false" })).toBe("false");
    expect(effectiveValue("boolean", split, undefined)).toBeNull();
    expect(effectiveValue("categorical", [label("a", "good"), label("b", "good")], undefined)).toBe("good");
    expect(effectiveValue("numeric", [label("a", "4"), label("b", "5"), label("c", "5")], undefined)).toBe("5");
    expect(effectiveValue("numeric", [], undefined)).toBeNull();
  });
});
