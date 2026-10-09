import { describe, expect, it } from "vitest";
import { ID_KEY, ID_LIKE_VALUE_PATTERN, classifyAttribute, isTechnicalAttribute, type AttributeStats } from "@/domain/attribute-classification";

const stats = (over: Partial<AttributeStats> = {}): AttributeStats => ({ key: "city", count: 100, nonEmpty: 100, distinct: 8, numericCount: 0, avgLength: 7, idLikeCount: 0, ...over });
const kindOf = (over: Partial<AttributeStats>) => classifyAttribute(stats(over)).kind;

describe("classifyAttribute (ADR-078, phase 2)", () => {
  it("a label with a few different values is a category and is shown", () => {
    expect(classifyAttribute(stats())).toEqual({ kind: "category", numeric: false, hiddenByDefault: false });
    expect(kindOf({ key: "gen_ai.tool.name", distinct: 6, avgLength: 14 })).toBe("category");
  });

  it("instrumentation plumbing is technical and hidden, whatever its values", () => {
    expect(classifyAttribute(stats({ key: "memtrace.step_type" }))).toMatchObject({ kind: "technical", hiddenByDefault: true });
    expect(kindOf({ key: "gen_ai.usage.input_tokens", numericCount: 100, distinct: 90 })).toBe("technical");
    expect(kindOf({ key: "exception.type" })).toBe("technical");
    expect(isTechnicalAttribute("gen_ai.request.model")).toBe(false);
  });

  it("a key named like an id is an id, even if its values are numbers", () => {
    expect(classifyAttribute(stats({ key: "customer_id", numericCount: 100, distinct: 90, avgLength: 6 }))).toMatchObject({ kind: "id", numeric: true, hiddenByDefault: true });
    for (const key of ["user.uuid", "order-guid", "customerId", "id", "session.id"]) expect(ID_KEY.test(key), key).toBe(true);
    for (const key of ["video", "paid", "identifier", "city", "valid"]) expect(ID_KEY.test(key), key).toBe(false);
  });

  it("values shaped like uuids or long hashes make an id, even under an innocent name", () => {
    expect(kindOf({ key: "request", idLikeCount: 97, distinct: 100, avgLength: 36 })).toBe("id");
    // con solo el 40 % de los valores con forma de id y poca variedad, no es un id
    expect(kindOf({ key: "request", idLikeCount: 40, distinct: 30, avgLength: 20 })).toBe("category");
  });

  it("the id pattern the query uses matches ids and not long words", () => {
    const re = new RegExp(ID_LIKE_VALUE_PATTERN);
    expect(re.test("3f2b8c1e-9d4a-4c7e-8a55-1b2c3d4e5f60")).toBe(true);
    expect(re.test("507f1f77bcf86cd799439011aabbccdd")).toBe(true);
    expect(re.test("1696842000123")).toBe(true);
    expect(re.test("get_air_quality_forecast_hourly")).toBe(false);
    expect(re.test("12345")).toBe(false);
    expect(re.test("Madrid")).toBe(false);
  });

  it("a measure is a number and stays visible; one with few values is also a category", () => {
    expect(classifyAttribute(stats({ key: "order_total", numericCount: 100, distinct: 85, avgLength: 5 }))).toEqual({ kind: "number", numeric: true, hiddenByDefault: false });
    expect(classifyAttribute(stats({ key: "rating", numericCount: 100, distinct: 5, avgLength: 1 }))).toEqual({ kind: "category", numeric: true, hiddenByDefault: false });
  });

  it("a few non-numeric values among numbers do not stop it being numeric, many do", () => {
    expect(classifyAttribute(stats({ key: "amount", numericCount: 96, distinct: 50 })).numeric).toBe(true);
    expect(classifyAttribute(stats({ key: "amount", numericCount: 90, distinct: 50 })).numeric).toBe(false);
  });

  it("long values are free text and hidden", () => {
    expect(classifyAttribute(stats({ key: "message", distinct: 90, avgLength: 140 }))).toMatchObject({ kind: "text", hiddenByDefault: true });
    expect(kindOf({ key: "label", avgLength: 60 })).toBe("category");
  });

  it("a value that is different in almost every span is an id, but only with enough spans to say so", () => {
    expect(kindOf({ key: "trace_hint", count: 100, nonEmpty: 100, distinct: 95, avgLength: 12 })).toBe("id");
    expect(kindOf({ key: "trace_hint", count: 8, nonEmpty: 8, distinct: 8, avgLength: 12 })).toBe("category");
  });

  it("too many different values for a chart or a filter list is treated as an id", () => {
    expect(kindOf({ key: "city", nonEmpty: 100_000, count: 100_000, distinct: 500, avgLength: 9 })).toBe("id");
    expect(kindOf({ key: "city", nonEmpty: 100_000, count: 100_000, distinct: 150, avgLength: 9 })).toBe("category");
  });

  it("an attribute that never carries a value is harmless, not numeric and not hidden", () => {
    expect(classifyAttribute(stats({ key: "empty", nonEmpty: 0, distinct: 0, numericCount: 0, avgLength: 0 }))).toEqual({ kind: "category", numeric: false, hiddenByDefault: false });
  });
});
