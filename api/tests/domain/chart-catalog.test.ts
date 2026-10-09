import { describe, expect, it } from "vitest";
import { MAX_NAME, isEmptyEdit, nameClash, validateDisplayName, validateKey, validateKind, validateVisibility, type CatalogEntry } from "@/domain/chart-catalog";
import { ValidationError } from "@/domain/errors";

const entry = (key: string, displayName: string | null, kind: "step" | "attribute" = "step"): CatalogEntry => ({ kind, key, displayName, visibility: "auto", updatedBy: null, updatedAt: "t" });

describe("catalog validation", () => {
  it("accepts the two kinds and nothing else", () => {
    expect(validateKind("step")).toBe("step");
    expect(validateKind("attribute")).toBe("attribute");
    expect(() => validateKind("span")).toThrow(ValidationError);
    expect(() => validateKind(undefined)).toThrow(ValidationError);
  });

  it("trims the key and bounds its length", () => {
    expect(validateKey("  gen_ai.tool.name ")).toBe("gen_ai.tool.name");
    expect(() => validateKey("   ")).toThrow(ValidationError);
    expect(() => validateKey("x".repeat(301))).toThrow(ValidationError);
    expect(() => validateKey(42)).toThrow(ValidationError);
  });

  it("cleans a name, and treats a blank or missing one as 'no own name'", () => {
    expect(validateDisplayName("  Filtro   de datos  personales ")).toBe("Filtro de datos personales");
    expect(validateDisplayName("")).toBeNull();
    expect(validateDisplayName("   ")).toBeNull();
    expect(validateDisplayName(null)).toBeNull();
    expect(validateDisplayName(undefined)).toBeNull();
  });

  it("refuses names that are too long, not text or with control characters", () => {
    expect(validateDisplayName("x".repeat(MAX_NAME))).toHaveLength(MAX_NAME);
    expect(() => validateDisplayName("x".repeat(MAX_NAME + 1))).toThrow(ValidationError);
    expect(() => validateDisplayName(5)).toThrow(ValidationError);
    expect(() => validateDisplayName("uno\u0000dos")).toThrow(ValidationError);
  });

  it("defaults visibility to automatic and refuses unknown values", () => {
    expect(validateVisibility(undefined)).toBe("auto");
    expect(validateVisibility("hidden")).toBe("hidden");
    expect(() => validateVisibility("secret")).toThrow(ValidationError);
  });

  it("an edit that says nothing is empty", () => {
    expect(isEmptyEdit(null, "auto")).toBe(true);
    expect(isEmptyEdit("Name", "auto")).toBe(false);
    expect(isEmptyEdit(null, "hidden")).toBe(false);
  });
});

describe("nameClash", () => {
  const entries = [entry("input_guardrail", "Input filter"), entry("tool_x", "Tools", "attribute")];

  it("finds another entry of the same kind with that name, ignoring case", () => {
    expect(nameClash(entries, "step", "output_guardrail", "input FILTER")?.key).toBe("input_guardrail");
  });

  it("does not clash with itself, with another kind or with a free name", () => {
    expect(nameClash(entries, "step", "input_guardrail", "Input filter")).toBeNull();
    expect(nameClash(entries, "step", "other", "Tools")).toBeNull();
    expect(nameClash(entries, "step", "other", "Unused")).toBeNull();
  });
});
