import { describe, expect, it } from "vitest";
import { automaticLabel, distinctLabel, hiddenByDefault, hiddenReason, isAttributeShown, kindOf, type AttributeInfo } from "@/domain/attribute-visibility";

const attr = (over: Partial<AttributeInfo> = {}): AttributeInfo => ({ key: "city", count: 10, kind: "category", distinct: 8, numeric: false, hiddenByDefault: false, ...over });
const id = attr({ key: "customer_id", kind: "id", hiddenByDefault: true, numeric: true });

describe("which attributes the selectors offer (ADR-078, phase 2)", () => {
  it("in automatic, the classification decides", () => {
    expect(isAttributeShown(attr(), "auto")).toBe(true);
    expect(isAttributeShown(id, "auto")).toBe(false);
  });

  it("what the person chose wins over the classification, both ways", () => {
    expect(isAttributeShown(id, "shown")).toBe(true);
    expect(isAttributeShown(attr(), "hidden")).toBe(false);
  });

  it("explains why something is hidden, and says nothing about what is shown", () => {
    expect(hiddenReason(id, "auto")).toBe("Hidden automatically: it is different in almost every step, so a chart would get one bar per value");
    expect(hiddenReason(attr({ key: "message", kind: "text", hiddenByDefault: true }), "auto")).toContain("long free texts");
    expect(hiddenReason(attr({ key: "memtrace.x", kind: "technical", hiddenByDefault: true }), "auto")).toContain("instrumentation detail");
    expect(hiddenReason(attr(), "hidden")).toBe("Hidden by you");
    expect(hiddenReason(attr(), "auto")).toBeNull();
    expect(hiddenReason(id, "shown")).toBeNull();
  });

  it("the automatic option tells what automatic will do", () => {
    expect(automaticLabel(attr())).toBe("Automatic (shown)");
    expect(automaticLabel(id)).toBe("Automatic (hidden)");
  });

  it("an API from before the classification falls back to hiding only technical details by name", () => {
    const old: AttributeInfo = { key: "memtrace.step_type", count: 3 };
    expect(kindOf(old)).toBe("technical");
    expect(hiddenByDefault(old)).toBe(true);
    expect(hiddenByDefault({ key: "city", count: 3 })).toBe(false);
    expect(kindOf({ key: "city", count: 3 })).toBe("category");
  });

  it("counts the different values in plain words", () => {
    expect(distinctLabel(attr({ distinct: 1 }))).toBe("1 value");
    expect(distinctLabel(attr({ distinct: 1200 }))).toBe(`${(1200).toLocaleString()} different values`);
    expect(distinctLabel({ key: "k", count: 1 })).toBeNull();
  });
});
