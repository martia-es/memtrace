import { describe, expect, it } from "vitest";
import { alignmentLabel, feedbackTone, formatSatisfaction } from "@/domain/feedback";

describe("user feedback helpers", () => {
  it("picks the tone of the majority and warns on a tie", () => {
    expect(feedbackTone(3, 1)).toBe("ok");
    expect(feedbackTone(0, 2)).toBe("error");
    expect(feedbackTone(1, 1)).toBe("warn");
    expect(feedbackTone(0, 0)).toBe("neutral");
  });

  it("says in plain words whether users agree with the reviewers", () => {
    expect(alignmentLabel("aligned")).toBe("Matches the reviewers");
    expect(alignmentLabel("misaligned")).toBe("Disagrees with the reviewers");
    expect(alignmentLabel("unknown")).toBeNull();
  });

  it("formats satisfaction", () => {
    expect(formatSatisfaction(86.6)).toBe("87%");
    expect(formatSatisfaction(null)).toBe("–");
  });
});
