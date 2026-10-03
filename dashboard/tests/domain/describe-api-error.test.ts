import { describe, expect, it } from "vitest";
import { ApiError } from "@/application/trace-api";
import { describeApiError } from "@/application/describe-api-error";

describe("describeApiError", () => {
  it("explains that no experiment exists or is selected", () => {
    expect(describeApiError(new ApiError(404, "Not Found", "Experiment not found"))).toContain("doesn't exist");
  });

  it("separates trace and conversation 404s and mentions retention", () => {
    expect(describeApiError(new ApiError(404, "Not Found", "Trace abc not found"))).toContain("retention");
    expect(describeApiError(new ApiError(404, "Not Found", "Conversation c1 not found"))).toContain("conversation");
  });

  it("tells the user when they lack access or the session expired", () => {
    expect(describeApiError(new ApiError(403, "Forbidden", "No access to this experiment"))).toContain("access");
    expect(describeApiError(new ApiError(401, "Unauthorized", "Login required"))).toContain("session");
  });

  it("keeps the raw message for plain errors", () => {
    expect(describeApiError(new Error("boom"))).toBe("boom");
  });
});
