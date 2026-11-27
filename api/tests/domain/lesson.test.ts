import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/domain/permissions";
import { ValidationError } from "@/domain/errors";
import {
  EDITABLE_STATUSES,
  LESSON_STATUSES,
  LESSON_TRANSITIONS,
  MAX_GUIDANCE,
  contentHash,
  findingFingerprint,
  isServable,
  requiredPermission,
  validateContent,
  validateEnvironment,
} from "@/domain/lesson";

const valid = { title: "No repitas search_flights", guidance: "Si search_flights falla, espera.", match: { tools: ["search_flights"] } };

describe("lesson state machine", () => {
  it("only lets a person with lesson:approve activate or retire; review is not enough", () => {
    expect(requiredPermission("reviewed", "approved")).toBe("lesson:approve");
    expect(requiredPermission("approved", "retired")).toBe("lesson:approve");
    expect(requiredPermission("proposed", "reviewed")).toBe("lesson:review");
  });

  it("forbids skipping review and leaving the terminal state", () => {
    expect(requiredPermission("proposed", "approved")).toBeNull();
    expect(Object.keys(LESSON_TRANSITIONS.retired)).toEqual([]);
  });

  it("covers every status and only editable ones can be edited", () => {
    expect(Object.keys(LESSON_TRANSITIONS).sort()).toEqual([...LESSON_STATUSES].sort());
    expect(EDITABLE_STATUSES).not.toContain("retired");
    expect(EDITABLE_STATUSES).not.toContain("dismissed");
  });

  it("a dismissed lesson can be reopened by a reviewer, never approved directly", () => {
    expect(requiredPermission("dismissed", "proposed")).toBe("lesson:review");
    expect(requiredPermission("dismissed", "approved")).toBeNull();
  });
});

describe("lesson permissions in the built-in roles", () => {
  const perms = (role: string) => BUILT_IN_ROLES.find((r) => r.name === role)!.permissions;
  it("business reviews but does not approve (putting an instruction in the agent is a technical decision)", () => {
    expect(perms("business")).toContain("lesson:review");
    expect(perms("business")).not.toContain("lesson:approve");
  });
  it("technical approves; governance only reads", () => {
    expect(perms("technical")).toContain("lesson:approve");
    expect(perms("governance")).toEqual(expect.arrayContaining(["lesson:read"]));
    expect(perms("governance")).not.toContain("lesson:review");
  });
});

describe("validateContent", () => {
  it("trims and accepts a lesson with at least one trigger", () => {
    const c = validateContent({ ...valid, title: "  T  " });
    expect(c.title).toBe("T");
    expect(c.situation).toBe("");
  });

  it("requires a trigger: a lesson that never matches, or always matches, is rejected", () => {
    expect(() => validateContent({ ...valid, match: {} })).toThrow(ValidationError);
    expect(() => validateContent({ ...valid, match: { tools: [] } })).toThrow(ValidationError);
    expect(() => validateContent({ ...valid, match: "tools" })).toThrow(ValidationError);
  });

  it("bounds the text injected into the agent", () => {
    expect(() => validateContent({ ...valid, guidance: "x".repeat(MAX_GUIDANCE + 1) })).toThrow(/at most/);
    expect(() => validateContent({ ...valid, guidance: "  " })).toThrow(/empty/);
  });

  it("deduplicates and limits the trigger lists", () => {
    expect(validateContent({ ...valid, match: { tools: ["a", "a", "b"] } }).match.tools).toEqual(["a", "b"]);
    expect(() => validateContent({ ...valid, match: { tools: Array.from({ length: 11 }, (_, i) => `t${i}`) } })).toThrow(/at most 10/);
  });
});

describe("hashes and fingerprints", () => {
  it("the content hash ignores the order of the triggers but not the guidance", () => {
    const a = validateContent({ ...valid, match: { tools: ["a", "b"] } });
    const b = validateContent({ ...valid, match: { tools: ["b", "a"] } });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash({ ...a, guidance: "otra" }));
  });

  it("the fingerprint is stable and separates experiments", () => {
    expect(findingFingerprint("e1", "f1")).toBe(findingFingerprint("e1", "f1"));
    expect(findingFingerprint("e1", "f1")).not.toBe(findingFingerprint("e2", "f1"));
  });

  it("only an approved lesson turned on somewhere is servable", () => {
    expect(isServable("approved", ["pro"])).toBe(true);
    expect(isServable("approved", [])).toBe(false);
    expect(isServable("reviewed", ["pro"])).toBe(false);
  });

  it("validates environment keys", () => {
    expect(validateEnvironment("pro")).toBe("pro");
    expect(() => validateEnvironment("Pro!")).toThrow(ValidationError);
  });
});
