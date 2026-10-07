import { describe, expect, it } from "vitest";
import { ScoreConfigInvariantError, ScoreConfigShapeError } from "@/domain/errors";
import { applyScoreConfigPatch, validateNewScoreConfig, type NewScoreConfig, type ScoreConfig } from "@/domain/score-config";

const base: NewScoreConfig = { name: " tone ", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, description: "  " };

const stored = (overrides: Partial<ScoreConfig> = {}): ScoreConfig => ({
  id: "c1",
  experimentId: "e1",
  name: "tone",
  dataType: "numeric",
  minValue: 1,
  maxValue: 5,
  categories: null,
  targetPassRate: null,
  description: null,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  archivedAt: null,
  ...overrides,
});

const categorical = (overrides: Partial<ScoreConfig> = {}) =>
  stored({ dataType: "categorical", minValue: null, maxValue: null, categories: [{ label: "bad", value: 0 }, { label: "ok", value: 1 }], ...overrides });

describe("validateNewScoreConfig", () => {
  it("trims the name and blanks an empty description", () => {
    expect(validateNewScoreConfig(base)).toMatchObject({ name: "tone", description: null });
  });

  it("requires an increasing range for numeric", () => {
    expect(() => validateNewScoreConfig({ ...base, minValue: 5, maxValue: 5 })).toThrow(ScoreConfigShapeError);
    expect(() => validateNewScoreConfig({ ...base, minValue: null })).toThrow(ScoreConfigShapeError);
  });

  it("rejects range on boolean/categorical and categories on non-categorical", () => {
    expect(() => validateNewScoreConfig({ ...base, dataType: "boolean" })).toThrow(ScoreConfigShapeError);
    expect(() => validateNewScoreConfig({ ...base, categories: [{ label: "a", value: null }, { label: "b", value: null }] })).toThrow(ScoreConfigShapeError);
  });

  it("requires at least two unique non-empty categories", () => {
    const cat = (categories: NewScoreConfig["categories"]) => validateNewScoreConfig({ ...base, dataType: "categorical", minValue: null, maxValue: null, categories });
    expect(() => cat(null)).toThrow(ScoreConfigShapeError);
    expect(() => cat([{ label: "a", value: null }])).toThrow(ScoreConfigShapeError);
    expect(() => cat([{ label: "a", value: null }, { label: " a ", value: null }])).toThrow(ScoreConfigShapeError);
    expect(() => cat([{ label: "a", value: null }, { label: " ", value: null }])).toThrow(ScoreConfigShapeError);
    expect(cat([{ label: " a ", value: 0 }, { label: "b", value: null }]).categories).toEqual([{ label: "a", value: 0 }, { label: "b", value: null }]);
  });
});

describe("applyScoreConfigPatch", () => {
  it("allows widening the range and rejects narrowing", () => {
    expect(applyScoreConfigPatch(stored(), { minValue: 0, maxValue: 10 })).toMatchObject({ minValue: 0, maxValue: 10 });
    expect(() => applyScoreConfigPatch(stored(), { minValue: 2 })).toThrow(ScoreConfigInvariantError);
    expect(() => applyScoreConfigPatch(stored(), { maxValue: 4 })).toThrow(ScoreConfigInvariantError);
  });

  it("rejects an inverted range as a shape error", () => {
    expect(() => applyScoreConfigPatch(stored(), { minValue: -10, maxValue: -20 })).toThrow(ScoreConfigShapeError);
  });

  it("only touches the range of numeric configs", () => {
    expect(() => applyScoreConfigPatch(categorical(), { maxValue: 9 })).toThrow(ScoreConfigShapeError);
  });

  it("allows adding categories but not removing, renaming or revaluing", () => {
    const withNew = [{ label: "bad", value: 0 }, { label: "ok", value: 1 }, { label: "good", value: 2 }];
    expect(applyScoreConfigPatch(categorical(), { categories: withNew }).categories).toEqual(withNew);
    expect(() => applyScoreConfigPatch(categorical(), { categories: [{ label: "bad", value: 0 }, { label: "great", value: 1 }] })).toThrow(ScoreConfigInvariantError);
    expect(() => applyScoreConfigPatch(categorical(), { categories: [{ label: "bad", value: 5 }, { label: "ok", value: 1 }] })).toThrow(ScoreConfigInvariantError);
  });

  it("updates or clears the description without touching the rest", () => {
    expect(applyScoreConfigPatch(stored({ description: "x" }), { description: "y" })).toMatchObject({ description: "y", minValue: 1, maxValue: 5 });
    expect(applyScoreConfigPatch(stored({ description: "x" }), { description: null }).description).toBeNull();
    expect(applyScoreConfigPatch(stored({ description: "x" }), {}).description).toBe("x");
  });

  it("refuses to edit an archived config", () => {
    expect(() => applyScoreConfigPatch(stored({ archivedAt: "2026-01-01" }), { description: "y" })).toThrow(ScoreConfigInvariantError);
  });
});

describe("targetPassRate (ADR-060)", () => {
  const bool: NewScoreConfig = { name: "ok", dataType: "boolean", minValue: null, maxValue: null, categories: null, description: null };

  it("is optional and only valid on boolean configs within (0, 1]", () => {
    expect(validateNewScoreConfig(bool).targetPassRate).toBeNull();
    expect(validateNewScoreConfig({ ...bool, targetPassRate: 0.9 }).targetPassRate).toBe(0.9);
    expect(() => validateNewScoreConfig({ ...bool, targetPassRate: 0 })).toThrow(ScoreConfigShapeError);
    expect(() => validateNewScoreConfig({ ...bool, targetPassRate: 1.2 })).toThrow(ScoreConfigShapeError);
    expect(() => validateNewScoreConfig({ ...base, targetPassRate: 0.9 })).toThrow(ScoreConfigShapeError);
  });

  it("can be changed or cleared by a patch, but not on non-boolean configs", () => {
    const current = stored({ dataType: "boolean", minValue: null, maxValue: null, targetPassRate: 0.8 });
    expect(applyScoreConfigPatch(current, { targetPassRate: 0.95 }).targetPassRate).toBe(0.95);
    expect(applyScoreConfigPatch(current, { targetPassRate: null }).targetPassRate).toBeNull();
    expect(applyScoreConfigPatch(current, {}).targetPassRate).toBe(0.8);
    expect(() => applyScoreConfigPatch(stored(), { targetPassRate: 0.9 })).toThrow(ScoreConfigShapeError);
  });
});
