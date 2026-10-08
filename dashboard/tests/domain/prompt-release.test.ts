import { describe, expect, it } from "vitest";
import { environmentCoverage, filterVersions, groupByMonth, releaseStatus, releaseSummary, sortEnvironments, splitVariables, timelineCells } from "@/domain/prompt-release";

const p = (latestVersion: number, tags: Record<string, number>) => ({ latestVersion, tags });

describe("release status", () => {
  it("compares production with the latest version", () => {
    expect(releaseStatus(p(12, { pro: 9 }))).toEqual({ state: "behind", behindBy: 3 });
    expect(releaseStatus(p(7, { pro: 7 }))).toEqual({ state: "in_sync", behindBy: 0 });
    expect(releaseStatus(p(3, { dev: 3 }))).toEqual({ state: "not_released", behindBy: 0 });
  });

  it("summarises the whole list: prompts behind and versions waiting", () => {
    const list = [p(12, { dev: 12, pre: 11, pro: 9 }), p(7, { pro: 7 }), p(4, { pro: 2 }), p(3, { dev: 3 })];
    expect(releaseSummary(list)).toEqual({ behind: 2, inSync: 1, notReleased: 1, waitingVersions: 5 });
  });

  it("counts how many prompts each environment has pinned", () => {
    const list = [p(12, { dev: 12, pre: 11, pro: 9 }), p(3, { dev: 3 })];
    expect(environmentCoverage(list)).toEqual([
      { env: "dev", pinned: 2, total: 2 },
      { env: "pre", pinned: 1, total: 2 },
      { env: "pro", pinned: 1, total: 2 },
    ]);
  });
});

describe("version timeline", () => {
  it("hangs the tags on their version and marks what is ahead of production", () => {
    const { cells, older } = timelineCells(p(12, { dev: 12, pre: 11, pro: 9 }), 5);
    expect(cells.map((c) => c.version)).toEqual([8, 9, 10, 11, 12]);
    expect(older).toBe(7);
    expect(cells.find((c) => c.version === 9)).toMatchObject({ tags: ["pro"], ahead: false });
    expect(cells.find((c) => c.version === 10)).toMatchObject({ tags: [], ahead: true });
    expect(cells.find((c) => c.version === 12)).toMatchObject({ tags: ["dev"], latest: true });
  });

  it("starts at v1 when there are few versions and nothing is ahead without production", () => {
    const { cells, older } = timelineCells(p(3, { dev: 3 }));
    expect(cells.map((c) => c.version)).toEqual([1, 2, 3]);
    expect(older).toBe(0);
    expect(cells.some((c) => c.ahead)).toBe(false);
  });
});

describe("version list helpers", () => {
  it("orders the usual environments first", () => {
    expect(sortEnvironments(["stable", "pro", "dev", "pre", "exp"])).toEqual(["dev", "pre", "pro", "exp", "stable"]);
  });

  it("groups versions by month, newest first", () => {
    const groups = groupByMonth([{ createdAt: "2026-10-15T12:00:00Z" }, { createdAt: "2026-10-03T12:00:00Z" }, { createdAt: "2026-09-20T12:00:00Z" }]);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["October 2026", 2], ["September 2026", 1]]);
  });

  it("filters by version number or message", () => {
    const list = [{ version: 12, message: "Shorter alerts" }, { version: 2, message: "Cite the source" }, { version: 1, message: "First draft" }];
    expect(filterVersions(list, "v12").map((v) => v.version)).toEqual([12]);
    expect(filterVersions(list, "2").map((v) => v.version)).toEqual([2]);
    expect(filterVersions(list, "SOURCE").map((v) => v.version)).toEqual([2]);
    expect(filterVersions(list, "  ")).toHaveLength(3);
  });

  it("splits a line to highlight its variables", () => {
    expect(splitVariables("Answer in {{language}} please")).toEqual([
      { text: "Answer in ", variable: false },
      { text: "{{language}}", variable: true },
      { text: " please", variable: false },
    ]);
    expect(splitVariables("")).toEqual([]);
  });
});
