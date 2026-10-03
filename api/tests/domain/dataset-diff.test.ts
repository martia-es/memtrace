import { describe, expect, it } from "vitest";
import { countChangesPerVersion, diffDatasetVersions } from "@/domain/dataset-diff";
import type { DatasetItem } from "@/domain/identity";

function item(origin: string, overrides: Partial<DatasetItem> = {}): DatasetItem {
  return {
    id: `${origin}-row-${Math.random()}`,
    originItemId: origin,
    datasetVersionId: "v1",
    input: `input ${origin}`,
    expectedOutput: "ok",
    metadata: null,
    createdBy: "u1",
    createdByEmail: "a@x.com",
    createdAt: "2026-10-01T00:00:00Z",
    updatedBy: null,
    updatedByEmail: null,
    updatedAt: null,
    deletedBy: null,
    deletedByEmail: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("diffDatasetVersions", () => {
  it("does not report unchanged clones, even when their ids and audit fields differ", () => {
    const base = [item("a"), item("b")];
    const target = [item("a", { updatedBy: "u2", updatedAt: "2026-10-02T00:00:00Z" }), item("b")];
    expect(diffDatasetVersions(base, target)).toEqual({ changes: [], unchangedCount: 2 });
  });

  it("reports added, modified and removed items by origin", () => {
    const base = [item("a"), item("b"), item("c")];
    const tombstone = item("c", { deletedAt: "2026-10-02T00:00:00Z", deletedBy: "u2" });
    const target = [item("a", { input: "changed" }), item("b"), item("d"), tombstone];
    const { changes, unchangedCount } = diffDatasetVersions(base, target);
    expect(unchangedCount).toBe(1);
    expect(changes.map((c) => [c.originItemId, c.kind])).toEqual([
      ["a", "modified"],
      ["d", "added"],
      ["c", "removed"],
    ]);
    expect(changes.find((c) => c.kind === "removed")?.after).toBe(tombstone);
  });

  it("compares non-adjacent versions and ignores items added and deleted in between", () => {
    const base = [item("a")];
    const target = [item("a"), item("x", { deletedAt: "2026-10-03T00:00:00Z" })];
    expect(diffDatasetVersions(base, target)).toEqual({ changes: [], unchangedCount: 1 });
  });

  it("treats everything as added when there is no base", () => {
    expect(diffDatasetVersions([], [item("a"), item("b")]).changes.map((c) => c.kind)).toEqual(["added", "added"]);
  });
});

describe("countChangesPerVersion", () => {
  it("counts real changes against the previous version, not the whole dataset", () => {
    const v1 = [item("a", { datasetVersionId: "v1" })];
    const v2 = [item("a", { datasetVersionId: "v2" }), item("b", { datasetVersionId: "v2" })];
    const v3 = [item("a", { datasetVersionId: "v3", input: "edited" }), item("b", { datasetVersionId: "v3" })];
    const counts = countChangesPerVersion([{ id: "v3" }, { id: "v2" }, { id: "v1" }], [...v1, ...v2, ...v3]);
    expect(counts.get("v3")).toEqual({ itemCount: 2, addedCount: 0, modifiedCount: 1, removedCount: 0 });
    expect(counts.get("v2")).toEqual({ itemCount: 2, addedCount: 1, modifiedCount: 0, removedCount: 0 });
    expect(counts.get("v1")).toEqual({ itemCount: 1, addedCount: 0, modifiedCount: 0, removedCount: 0 });
  });
});
