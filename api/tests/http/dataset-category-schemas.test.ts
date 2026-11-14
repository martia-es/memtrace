import { describe, expect, it } from "vitest";
import { createDatasetBody, updateDatasetBody } from "@/adapters/inbound/http/schemas";

describe("dataset category schemas", () => {
  it("accepts a known category, no category, or null on create", () => {
    expect(createDatasetBody.parse({ name: "a", category: "security" }).category).toBe("security");
    expect(createDatasetBody.parse({ name: "a" }).category).toBeUndefined();
    expect(createDatasetBody.parse({ name: "a", category: null }).category).toBeNull();
  });

  it("rejects an unknown category", () => {
    expect(() => createDatasetBody.parse({ name: "a", category: "nope" })).toThrow();
    expect(() => updateDatasetBody.parse({ category: "nope" })).toThrow();
  });

  it("requires the category on PATCH (null clears it) and rejects other fields", () => {
    expect(updateDatasetBody.parse({ category: null }).category).toBeNull();
    expect(() => updateDatasetBody.parse({})).toThrow();
    expect(() => updateDatasetBody.parse({ category: "functional", name: "x" })).toThrow();
  });
});
