import { describe, expect, it } from "vitest";
import { assertRubricOnlyGrows, deriveItemStatus, validateNewQueue, validateQueueLabels } from "@/domain/annotation-queue";
import { AnnotationQueueInvariantError, AnnotationValueError, ValidationError } from "@/domain/errors";
import type { ScoreConfig } from "@/domain/score-config";

const config = (over: Partial<ScoreConfig> & { id: string }): ScoreConfig => ({
  experimentId: "e1",
  name: over.id,
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
  ...over,
});

describe("deriveItemStatus", () => {
  it("is completed once enough reviewers finished", () => {
    expect(deriveItemStatus("pending", 1, 2)).toBe("pending");
    expect(deriveItemStatus("pending", 2, 2)).toBe("completed");
  });
  it("reopens a completed item when the requirement goes up and completes it when it goes down", () => {
    expect(deriveItemStatus("completed", 1, 2)).toBe("pending");
    expect(deriveItemStatus("pending", 1, 1)).toBe("completed");
  });
  it("never recomputes an item an admin marked unreviewable", () => {
    expect(deriveItemStatus("skipped", 5, 1)).toBe("skipped");
  });
});

describe("validateNewQueue", () => {
  const base = { name: "  Review  ", instructions: "  ", requiredAnnotations: 2, reviewerIds: ["u1", "u2"], rubric: [{ configId: "a", required: true }] };
  it("trims the name and drops blank instructions", () => {
    expect(validateNewQueue(base)).toMatchObject({ name: "Review", instructions: null });
  });
  it.each([
    ["empty name", { name: " " }],
    ["zero annotations", { requiredAnnotations: 0 }],
    ["too many annotations", { requiredAnnotations: 11 }],
    ["empty rubric", { rubric: [] }],
    ["no reviewers", { reviewerIds: [] }],
    ["duplicate reviewer", { reviewerIds: ["u1", "u1"] }],
    ["more annotations than reviewers", { requiredAnnotations: 3 }],
    ["duplicate config", { rubric: [{ configId: "a", required: true }, { configId: "a", required: false }] }],
  ])("rejects %s", (_label, over) => {
    expect(() => validateNewQueue({ ...base, ...over })).toThrow(ValidationError);
  });
});

describe("assertRubricOnlyGrows", () => {
  const current = [{ configId: "a", required: true, position: 0 }];
  it("allows adding configs and rejects removing one", () => {
    expect(() => assertRubricOnlyGrows(current, [{ configId: "a" }, { configId: "b" }])).not.toThrow();
    expect(() => assertRubricOnlyGrows(current, [{ configId: "b" }])).toThrow(AnnotationQueueInvariantError);
  });
});

describe("validateQueueLabels", () => {
  const queue = {
    rubric: [
      { configId: "tone", required: true, position: 0 },
      { configId: "note", required: false, position: 1 },
    ],
  };
  const configs = [config({ id: "tone" }), config({ id: "note", dataType: "boolean", minValue: null, maxValue: null })];

  it("normalizes values and returns them in rubric order", () => {
    const out = validateQueueLabels(queue, configs, [
      { configId: "note", value: "TRUE", comment: " ok " },
      { configId: "tone", value: " 4 " },
    ]);
    expect(out.map((o) => [o.config.id, o.value, o.comment])).toEqual([["tone", "4", null], ["note", "true", "ok"]]);
  });
  it("requires every required config", () => {
    expect(() => validateQueueLabels(queue, configs, [{ configId: "note", value: true }])).toThrow(/Missing required/);
  });
  it("lets optional configs be left out", () => {
    expect(validateQueueLabels(queue, configs, [{ configId: "tone", value: 3 }])).toHaveLength(1);
  });
  it("rejects configs outside the rubric and duplicates", () => {
    expect(() => validateQueueLabels(queue, configs, [{ configId: "tone", value: 3 }, { configId: "zzz", value: 1 }])).toThrow(ValidationError);
    expect(() => validateQueueLabels(queue, configs, [{ configId: "tone", value: 3 }, { configId: "tone", value: 4 }])).toThrow(expect.objectContaining({ fields: { tone: expect.stringContaining("twice") } }));
  });
  it("applies the config's own value rules", () => {
    expect(() => validateQueueLabels(queue, configs, [{ configId: "tone", value: 9 }])).toThrow(AnnotationValueError);
  });
  it("does not require an archived config but refuses labels for it", () => {
    const archived = [config({ id: "tone", archivedAt: "x" }), configs[1]!];
    expect(validateQueueLabels(queue, archived, [])).toEqual([]);
    expect(() => validateQueueLabels(queue, archived, [{ configId: "tone", value: 3 }])).toThrow(expect.objectContaining({ fields: { tone: expect.stringContaining("archived") } }));
  });
});
