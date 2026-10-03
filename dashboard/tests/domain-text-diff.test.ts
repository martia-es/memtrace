import { describe, expect, it } from "vitest";
import { itemDiffText, sideBySideDiff } from "@/domain/text-diff";

describe("sideBySideDiff", () => {
  it("pairs a removed line with its replacement and keeps both columns aligned", () => {
    const rows = sideBySideDiff("a\nb\nc", "a\nB\nc");
    expect(rows.map((r) => [r.left.kind, r.left.text, r.right.kind, r.right.text])).toEqual([
      ["same", "a", "same", "a"],
      ["del", "b", "add", "B"],
      ["same", "c", "same", "c"],
    ]);
  });

  it("shows a pure addition as empty on the old side", () => {
    expect(sideBySideDiff("a", "a\nb").at(-1)).toEqual({ left: { text: "", kind: "empty" }, right: { text: "b", kind: "add" } });
  });

  it("shows a whole new item as all additions", () => {
    const rows = sideBySideDiff("", itemDiffText({ input: "q", expectedOutput: "a", metadata: null }));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.left.kind === "empty" && r.right.kind === "add")).toBe(true);
  });
});
