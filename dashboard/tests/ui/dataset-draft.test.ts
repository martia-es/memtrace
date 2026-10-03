import { describe, expect, it } from "vitest";
import { blankRow, buildCommit, nextVersionLabel, parseClipboardGrid, pasteGrid, rowProblem, rowState, rowsFromItems, summarize } from "@/ui/dataset-draft";
import { datasetItemDto } from "../fakes";

const base = () => rowsFromItems([datasetItemDto({ id: "a", input: "2+2?", expectedOutput: "4" }), datasetItemDto({ id: "b", input: { q: 1 }, expectedOutput: null })]);

describe("dataset draft (ADR-041)", () => {
  it("starts clean with a trailing blank row", () => {
    const rows = base();
    expect(rows.map(rowState)).toEqual(["clean", "clean", "empty"]);
    expect(summarize(rows)).toEqual({ added: 0, edited: 0, removed: 0, problems: 0 });
  });

  it("collects adds, edits and removals into one commit with only changed fields", () => {
    const rows = base();
    rows[0]!.expected = "four";
    rows[1]!.removed = true;
    rows[2]!.input = "new question";
    const body = buildCommit(rows);
    expect(body.update).toEqual([{ id: "a", expectedOutput: "four" }]);
    expect(body.remove).toEqual(["b"]);
    expect(body.add).toEqual([{ input: "new question", expectedOutput: null, metadata: null }]);
  });

  it("predicts the version like the server: structural → major, edits only → minor", () => {
    const rows = base();
    rows[0]!.input = "edited";
    expect(nextVersionLabel({ major: 2, minor: 1 }, summarize(rows))).toBe("v2.2");
    rows[2]!.input = "added";
    expect(nextVersionLabel({ major: 2, minor: 1 }, summarize(rows))).toBe("v3.0");
  });

  it("an edit reverted by hand is not a change", () => {
    const rows = base();
    rows[0]!.input = "x";
    rows[0]!.input = "2+2?";
    expect(rowState(rows[0]!)).toBe("clean");
  });

  it("flags rows that cannot be published", () => {
    const row = blankRow({ expected: "only an answer" });
    expect(rowProblem(row)).toBe("Input is required");
    expect(rowProblem(blankRow({ input: "q", metadata: "[1]" }))).toBe("Metadata must be a JSON object");
  });

  it("keeps plain numbers as text but parses JSON objects", () => {
    const rows = base();
    rows[2]!.input = '{"city":"Madrid"}';
    rows[2]!.expected = "42";
    expect(buildCommit(rows).add).toEqual([{ input: { city: "Madrid" }, expectedOutput: "42", metadata: null }]);
  });

  it("parses Excel clipboard text, including quoted cells with line breaks", () => {
    expect(parseClipboardGrid('q1\ta1\n"multi\nline"\t"say ""hi"""\n')).toEqual([["q1", "a1"], ["multi\nline", 'say "hi"']]);
  });

  it("pastes a grid over existing rows and appends new ones, ending with a blank row", () => {
    const out = pasteGrid(base(), 1, 0, [["x", "y"], ["p", "q"], ["r", "s"]]);
    expect(out.slice(0, 5).map((r) => [r.input, r.expected])).toEqual([["2+2?", "4"], ["x", "y"], ["p", "q"], ["r", "s"], ["", ""]]);
    expect(rowState(out[out.length - 1]!)).toBe("empty");
    expect(rowState(out[1]!)).toBe("modified");
  });
});
