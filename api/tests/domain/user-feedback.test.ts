import { describe, expect, it } from "vitest";
import { UserFeedbackValueError } from "@/domain/errors";
import { feedbackAlignment, validateRating } from "@/domain/user-feedback";

const up = { rating: 1 as const };
const down = { rating: -1 as const };

describe("validateRating", () => {
  it("accepts thumbs up and thumbs down only", () => {
    expect(validateRating(1)).toBe(1);
    expect(validateRating(-1)).toBe(-1);
    for (const bad of [0, 2, "1", null, undefined, 0.5]) expect(() => validateRating(bad)).toThrow(UserFeedbackValueError);
  });
});

describe("feedbackAlignment", () => {
  it("is aligned when the user and the internal review agree", () => {
    expect(feedbackAlignment([up], { good: 1, bad: 0 })).toBe("aligned");
    expect(feedbackAlignment([down], { good: 0, bad: 1 })).toBe("aligned");
  });

  it("is misaligned when they disagree", () => {
    expect(feedbackAlignment([down], { good: 2, bad: 0 })).toBe("misaligned");
    expect(feedbackAlignment([up], { good: 0, bad: 1 })).toBe("misaligned");
  });

  it("treats any bad internal label as a bad verdict", () => {
    expect(feedbackAlignment([up], { good: 3, bad: 1 })).toBe("misaligned");
  });

  it("cannot compare without an internal verdict or with tied votes", () => {
    expect(feedbackAlignment([up], { good: 0, bad: 0 })).toBe("unknown");
    expect(feedbackAlignment([up, down], { good: 1, bad: 0 })).toBe("unknown");
    expect(feedbackAlignment([], { good: 1, bad: 0 })).toBe("unknown");
  });
});
