import { describe, expect, it } from "vitest";
import { validateAnnotationValue } from "@/domain/annotation";
import { AnnotationValueError } from "@/domain/errors";

const numeric = { dataType: "numeric" as const, minValue: 1, maxValue: 5, categories: null };
const boolean = { dataType: "boolean" as const, minValue: null, maxValue: null, categories: null };
const categorical = { dataType: "categorical" as const, minValue: null, maxValue: null, categories: [{ label: "bad", value: 0 }, { label: "ok", value: 1 }] };

describe("validateAnnotationValue", () => {
  it("accepts numbers inside the range (inclusive) and normalizes them", () => {
    expect(validateAnnotationValue(numeric, 3)).toBe("3");
    expect(validateAnnotationValue(numeric, " 4.50 ")).toBe("4.5");
    expect(validateAnnotationValue(numeric, 1)).toBe("1");
    expect(validateAnnotationValue(numeric, 5)).toBe("5");
  });

  it("rejects out-of-range, non-numeric and empty numeric values", () => {
    for (const bad of [0, 5.1, "abc", "", "  ", "Infinity"]) {
      expect(() => validateAnnotationValue(numeric, bad)).toThrow(AnnotationValueError);
    }
  });

  it("accepts true/false in any case and booleans, rejects anything else", () => {
    expect(validateAnnotationValue(boolean, true)).toBe("true");
    expect(validateAnnotationValue(boolean, "FALSE")).toBe("false");
    expect(() => validateAnnotationValue(boolean, "maybe")).toThrow(AnnotationValueError);
    expect(() => validateAnnotationValue(boolean, 1)).toThrow(AnnotationValueError);
  });

  it("accepts only the config's category labels, exactly", () => {
    expect(validateAnnotationValue(categorical, " ok ")).toBe("ok");
    expect(() => validateAnnotationValue(categorical, "OK")).toThrow(AnnotationValueError);
    expect(() => validateAnnotationValue(categorical, "good")).toThrow(/bad, ok/);
  });
});
