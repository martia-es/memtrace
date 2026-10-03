import { describe, expect, it } from "vitest";
import { describeScale, formatCategories, parseCategories } from "@/ui/score-config-form";

describe("parseCategories", () => {
  it("parses labels with optional numeric values and skips blank lines", () => {
    expect(parseCategories("bad=0\n\n ok = 1 \ngood")).toEqual([
      { label: "bad", value: 0 },
      { label: "ok", value: 1 },
      { label: "good", value: null },
    ]);
  });

  it("keeps a trailing non-numeric '=' as part of the label", () => {
    expect(parseCategories("a=b\nc=")).toEqual([
      { label: "a=b", value: null },
      { label: "c=", value: null },
    ]);
  });

  it("round-trips through formatCategories", () => {
    const text = "bad=0\nok=1\nunsure";
    expect(formatCategories(parseCategories(text))).toBe(text);
  });
});

describe("describeScale", () => {
  it("summarises each data type", () => {
    expect(describeScale({ dataType: "numeric", minValue: 1, maxValue: 5, categories: null })).toBe("1 – 5");
    expect(describeScale({ dataType: "boolean", minValue: null, maxValue: null, categories: null })).toBe("true / false");
    expect(describeScale({ dataType: "categorical", minValue: null, maxValue: null, categories: [{ label: "a", value: null }, { label: "b", value: 1 }] })).toBe("a · b");
  });
});
