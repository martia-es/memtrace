import { describe, expect, it } from "vitest";
import type { PromptVersionDto } from "@contract";
import { baseVersionFor, defaultRationale, failureOf } from "@/domain/prompt-fix";
import { node } from "../fakes";

const failed = (name: string, message: string | null, extra: Partial<Parameters<typeof node>[0]> = {}) => node({ name, status: { code: "error", message }, ...extra });
const version = (n: number, status: "draft" | "published" = "published"): PromptVersionDto => ({
  version: n, status, origin: null, publishedAt: status === "published" ? "t" : null, source: null, includes: [], content: `v${n}`, variables: [], contentHash: `h${n}`, parentVersion: null, message: "", createdBy: null, createdAt: "t",
});

describe("failureOf (ADR-072)", () => {
  it("names the deepest failing step, not the ones that only propagate its error", () => {
    const tool = failed("get_weather", "429 Too Many Requests");
    const llm = failed("agent", "tool call failed", { children: [failed("node", "tool call failed", { children: [tool] })] });
    expect(failureOf([llm])).toEqual({ step: "get_weather", message: "429 Too Many Requests" });
  });

  it("takes the first failure of the trace when several branches fail", () => {
    const root = node({ status: { code: "ok", message: null }, children: [failed("first", "boom"), failed("second", "bang")] });
    expect(failureOf([root])?.step).toBe("first");
  });

  it("reads the exception when the status has no message", () => {
    const step = failed("tool", null, { events: [{ name: "exception", time: "t", attributes: { "exception.message": "upstream said slow down" } }] });
    expect(failureOf([step])?.message).toBe("upstream said slow down");
  });

  it("says so when a step failed without any message", () => {
    expect(failureOf([failed("tool", null)])?.message).toContain("without a message");
  });

  it("keeps the message short", () => {
    expect(failureOf([failed("tool", "x".repeat(2000))])!.message).toHaveLength(300);
  });

  it("is null for a trace that did not fail", () => {
    expect(failureOf([node({ children: [node()] })])).toBeNull();
    expect(failureOf([])).toBeNull();
  });
});

describe("baseVersionFor", () => {
  const all = [version(5, "draft"), version(4), version(3), version(2)];

  it("starts from the version the trace used when it still exists and is published", () => {
    expect(baseVersionFor(all, 3, 4)?.version).toBe(3);
  });

  it("never starts from a draft, even if the trace used it", () => {
    expect(baseVersionFor(all, 5, 2)?.version).toBe(2);
  });

  it("falls back to the selected version, then to the latest published one", () => {
    expect(baseVersionFor(all, null, 2)?.version).toBe(2);
    expect(baseVersionFor(all, 99, 5)?.version).toBe(4);
    expect(baseVersionFor([version(1, "draft")], null, null)).toBeNull();
  });
});

describe("defaultRationale", () => {
  it("proposes the failure as the reason, and nothing without one", () => {
    expect(defaultRationale({ step: "get_weather", message: "429" })).toBe('Fixes a failure in "get_weather": 429');
    expect(defaultRationale(null)).toBe("");
  });
});
