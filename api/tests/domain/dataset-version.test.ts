import { describe, expect, it } from "vitest";
import { bumpForChanges, describeChanges } from "@/domain/dataset-version";

describe("dataset change sessions (ADR-041)", () => {
  it("bumps major on adds or removals, minor on edits only", () => {
    expect(bumpForChanges({ added: 1, edited: 0, removed: 0 })).toBe("major");
    expect(bumpForChanges({ added: 0, edited: 3, removed: 1 })).toBe("major");
    expect(bumpForChanges({ added: 0, edited: 3, removed: 0 })).toBe("minor");
  });

  it("describes only what changed", () => {
    expect(describeChanges({ added: 3, edited: 2, removed: 1 })).toBe("Added 3 · Edited 2 · Removed 1");
    expect(describeChanges({ added: 0, edited: 2, removed: 0 })).toBe("Edited 2");
  });
});
