import { describe, expect, it } from "vitest";
import type { PromptTagDto, PromptUsageDto } from "@contract";
import { describeUsage, environmentsRunning } from "@/domain/prompt-usage";

const usage = (extra: Partial<PromptUsageDto>): PromptUsageDto => ({ experimentId: "a1", environment: "pro", tag: "pro", version: 2, lastSeenAt: "2026-10-08T10:00:00.000Z", active: true, ...extra });
const tags: PromptTagDto[] = [
  { tag: "pro", version: 2, updatedBy: null, updatedAt: "t" },
  { tag: "dev", version: 5, updatedBy: null, updatedAt: "t" },
];

describe("describeUsage (ADR-068)", () => {
  it("is in sync when the agent runs the version its tag points to", () => {
    expect(describeUsage([usage({})], tags)[0]).toMatchObject({ state: "in_sync", tagVersion: 2 });
  });

  it("is behind when the tag moved and the agent has not caught up yet", () => {
    expect(describeUsage([usage({ environment: "dev", tag: "dev", version: 4 })], tags)[0]).toMatchObject({ state: "behind", tagVersion: 5 });
  });

  it("a pinned version follows no tag, so it can never be behind", () => {
    expect(describeUsage([usage({ tag: "", version: 1 })], tags)[0]).toMatchObject({ state: "pinned", tagVersion: null });
  });

  it("is stale when the agent stopped reporting, whatever the tag says", () => {
    expect(describeUsage([usage({ active: false, version: 1 })], tags)[0]!.state).toBe("stale");
  });

  it("a tag that no longer exists is not 'behind': there is nothing to be behind", () => {
    expect(describeUsage([usage({ tag: "gone" })], tags)[0]).toMatchObject({ state: "in_sync", tagVersion: null });
  });

  it("lists what needs attention first, then by environment and newest version", () => {
    const rows = describeUsage(
      [usage({ active: false, version: 1 }), usage({ environment: "dev", tag: "dev", version: 5 }), usage({ environment: "dev", tag: "dev", version: 4 }), usage({})],
      tags,
    );
    expect(rows.map((r) => [r.state, r.environment, r.version])).toEqual([["behind", "dev", 4], ["in_sync", "dev", 5], ["in_sync", "pro", 2], ["stale", "pro", 1]]);
  });
});

describe("environmentsRunning", () => {
  it("names the environments where a version runs now, once each, ignoring stale reports", () => {
    const all = [usage({ environment: "pro" }), usage({ environment: "pro", experimentId: "a2" }), usage({ environment: "pre" }), usage({ environment: "dev", active: false }), usage({ version: 9 })];
    expect(environmentsRunning(all, 2)).toEqual(["pre", "pro"]);
    expect(environmentsRunning(all, 3)).toEqual([]);
  });

  it("shows ? for an agent that declares no environment", () => {
    expect(environmentsRunning([usage({ environment: "" })], 2)).toEqual(["?"]);
  });
});
