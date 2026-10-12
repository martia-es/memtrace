import type { RunListItemDto } from "@contract";
import { describe, expect, it } from "vitest";
import { groupRuns } from "@/ui/run-groups";

const G = "7d9f6c44-0f5a-4d6e-9d0e-2d1c5a2b9e11";
const run = (id: string, over: Partial<RunListItemDto> = {}): RunListItemDto => ({
  id, name: "prompt-v7", versionMajor: 1, versionMinor: 2, itemCount: 10, status: "completed", createdAt: "2026-10-12T10:00:00Z",
  revision: null, revisionDirty: null, runGroup: null, aggregates: [], datasetId: "ds", datasetName: "D", ...over,
});
const acc = (passRate: number) => [{ name: "acc", dataType: "boolean" as const, passRate, average: null, count: 10, judges: [] }];
const exec = (id: string, index: number, passRate: number, over: Partial<RunListItemDto> = {}) =>
  run(id, { runGroup: { id: G, index, total: 3 }, aggregates: acc(passRate), ...over });

describe("groupRuns", () => {
  it("leaves runs without repetitions as they are", () => {
    const out = groupRuns([run("a"), run("b")]);
    expect(out.map((r) => [r.id, r.executions])).toEqual([["a", 1], ["b", 1]]);
  });

  it("folds the executions of a group into one row with their mean, keeping the order of the list", () => {
    const out = groupRuns([run("solo"), exec("e3", 3, 0.9), exec("e1", 1, 0.88), exec("e2", 2, 0.92)]);
    expect(out.map((r) => r.id)).toEqual(["solo", "e1"]);
    expect(out[1]).toMatchObject({ executions: 3, expected: 3, status: "completed" });
    expect(out[1]!.aggregates[0]!.passRate).toBeCloseTo(0.9);
  });

  it("is still running while executions are missing or uploading, and averages only the finished ones", () => {
    const [g] = groupRuns([exec("e1", 1, 0.8), exec("e2", 2, 1, { status: "running" })]);
    expect(g).toMatchObject({ executions: 2, expected: 3, status: "running" });
    expect(g!.aggregates[0]!.passRate).toBeCloseTo(0.8);
  });

  it("shows the newest creation time of the group", () => {
    const [g] = groupRuns([exec("e1", 1, 0.8, { createdAt: "2026-10-12T10:00:00Z" }), exec("e2", 2, 0.9, { createdAt: "2026-10-12T10:05:00Z" }), exec("e3", 3, 0.9, { createdAt: "2026-10-12T10:09:00Z" })]);
    expect(g!.createdAt).toBe("2026-10-12T10:09:00Z");
  });
});
