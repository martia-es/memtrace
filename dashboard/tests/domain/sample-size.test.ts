import { describe, expect, it } from "vitest";
import { isSmallSample, MIN_RELIABLE_RUNS } from "@/domain/sample-size";

describe("isSmallSample", () => {
  it("treats no runs as no data, not as a small sample", () => {
    expect(isSmallSample(0)).toBe(false);
  });

  it("flags few runs and stops flagging at the threshold", () => {
    expect(isSmallSample(1)).toBe(true);
    expect(isSmallSample(MIN_RELIABLE_RUNS - 1)).toBe(true);
    expect(isSmallSample(MIN_RELIABLE_RUNS)).toBe(false);
  });
});
