import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { isLowering, validateRiskInput } from "@/domain/risk";

describe("risk classification (ADR-102)", () => {
  it("only a move to a lower level is a lowering; classifying for the first time never is", () => {
    expect(isLowering("high", "limited")).toBe(true);
    expect(isLowering("limited", "minimal")).toBe(true);
    expect(isLowering("minimal", "high")).toBe(false);
    expect(isLowering("limited", "limited")).toBe(false);
    expect(isLowering(null, "minimal")).toBe(false);
  });

  it("requires an intended purpose for a high-risk agent only", () => {
    expect(() => validateRiskInput({ level: "high", intendedPurpose: "  ", knownLimitations: "" })).toThrow(ValidationError);
    expect(() => validateRiskInput({ level: "high", intendedPurpose: "Triage of insurance claims", knownLimitations: "" })).not.toThrow();
    expect(() => validateRiskInput({ level: "minimal", intendedPurpose: "", knownLimitations: "" })).not.toThrow();
  });

  it("rejects unknown levels and texts that are too long", () => {
    expect(() => validateRiskInput({ level: "prohibited" as never, intendedPurpose: "", knownLimitations: "" })).toThrow(ValidationError);
    expect(() => validateRiskInput({ level: "limited", intendedPurpose: "x".repeat(2001), knownLimitations: "" })).toThrow(ValidationError);
  });
});
