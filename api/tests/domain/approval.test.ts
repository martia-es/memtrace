import { describe, expect, it } from "vitest";
import { evaluateApproval, isExpired, looserThan, mergeRules, unreachableReason, validateRule, type ApprovalRule } from "@/domain/approval";
import { ValidationError } from "@/domain/errors";

const ctx = { validRoles: ["technical", "business"], environmentKeys: ["dev", "pre", "pro"] };
const rule = (over: Partial<ApprovalRule> = {}): ApprovalRule => ({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [], ...over });
const people = [
  { userId: "ana", roles: ["technical"] },
  { userId: "ben", roles: ["technical"] },
  { userId: "cris", roles: ["business"] },
];

describe("validateRule", () => {
  it("accepts a promote rule with profiles and default approvers", () => {
    const r = validateRule({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }], approvers: ["ana", "ana"] }, ctx);
    expect(r).toEqual({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }], approvers: ["ana"] });
  });

  it("publishing has no stage and is approved by technical profiles only", () => {
    expect(validateRule({ action: "publish", requirements: [{ role: "technical", min: 2 }] }, ctx).stage).toBe("");
    expect(() => validateRule({ action: "publish", requirements: [{ role: "business", min: 1 }] }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "publish", stage: "pro", requirements: [{ role: "technical", min: 1 }] }, ctx)).toThrow(ValidationError);
  });

  it("promote needs one of the organization's environments", () => {
    expect(() => validateRule({ action: "promote", stage: "qa", requirements: [{ role: "technical", min: 1 }] }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "promote", requirements: [{ role: "technical", min: 1 }] }, ctx)).toThrow(ValidationError);
  });

  it("rejects empty rules, bad counts, unknown or repeated profiles", () => {
    expect(() => validateRule({ action: "promote", stage: "pro" }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 0 }] }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 11 }] }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "promote", stage: "pro", requirements: [{ role: "ghost", min: 1 }] }, ctx)).toThrow(ValidationError);
    expect(() => validateRule({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }, { role: "technical", min: 2 }] }, ctx)).toThrow(ValidationError);
  });

  it("a rule made only of default approvers is valid", () => {
    expect(validateRule({ action: "promote", stage: "pre", approvers: ["ana"] }, ctx).requirements).toEqual([]);
  });
});

describe("mergeRules and looserThan", () => {
  it("stacking keeps the highest minimum per profile and unions the approvers", () => {
    const org = rule({ requirements: [{ role: "technical", min: 1 }], approvers: ["ana"] });
    const exp = rule({ requirements: [{ role: "technical", min: 2 }, { role: "business", min: 1 }], approvers: ["ben"] });
    const merged = mergeRules([org, exp])!;
    expect(merged.requirements).toEqual(expect.arrayContaining([{ role: "technical", min: 2 }, { role: "business", min: 1 }]));
    expect([...merged.approvers].sort()).toEqual(["ana", "ben"]);
  });

  it("no rules means no approval needed", () => {
    expect(mergeRules([])).toBeNull();
  });

  it("an experiment rule that asks for less than the organization is looser", () => {
    const org = rule({ requirements: [{ role: "technical", min: 2 }], approvers: ["ana"] });
    expect(looserThan(rule({ requirements: [{ role: "technical", min: 1 }], approvers: ["ana"] }), org)).toMatch(/cannot ask for fewer/);
    expect(looserThan(rule({ requirements: [{ role: "technical", min: 2 }], approvers: [] }), org)).toMatch(/default approvers/);
    expect(looserThan(rule({ requirements: [{ role: "technical", min: 3 }, { role: "business", min: 1 }], approvers: ["ana", "ben"] }), org)).toBeNull();
  });
});

describe("evaluateApproval", () => {
  const base = { requestedBy: "zoe", extraApprovers: [] as string[], people };

  it("needs the minimum number of approvals from the profile", () => {
    const r = rule({ requirements: [{ role: "technical", min: 2 }] });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }] }).outcome).toBe("pending");
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }, { userId: "ben", decision: "approve" }] }).outcome).toBe("approved");
  });

  it("asks for a technical and a business approval when the rule says so", () => {
    const r = rule({ requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }] });
    const onlyTech = evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }] });
    expect(onlyTech.outcome).toBe("pending");
    expect(onlyTech.reason).toMatch(/business/);
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }, { userId: "cris", decision: "approve" }] }).outcome).toBe("approved");
  });

  it("the requester's own approval never counts", () => {
    const r = rule();
    const out = evaluateApproval({ ...base, requestedBy: "ana", rule: r, decisions: [{ userId: "ana", decision: "approve" }] });
    expect(out.outcome).toBe("pending");
  });

  it("a default approver must approve even when the minimum is already met", () => {
    const r = rule({ requirements: [{ role: "technical", min: 1 }], approvers: ["ben"] });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }] })).toMatchObject({ outcome: "pending", missingApprovers: ["ben"] });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ben", decision: "approve" }] }).outcome).toBe("approved");
  });

  it("approvers added to the request are required too", () => {
    const r = rule();
    const out = evaluateApproval({ ...base, rule: r, extraApprovers: ["cris"], decisions: [{ userId: "ana", decision: "approve" }] });
    expect(out).toMatchObject({ outcome: "pending", missingApprovers: ["cris"] });
  });

  it("an approval from someone who cannot decide is ignored", () => {
    const r = rule({ requirements: [{ role: "business", min: 1 }] });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }, { userId: "nobody", decision: "approve" }] }).outcome).toBe("pending");
  });

  it("one rejection from someone who could decide closes it", () => {
    const r = rule();
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ben", decision: "reject" }, { userId: "ana", decision: "approve" }] })).toMatchObject({ outcome: "rejected", rejectedBy: "ben" });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "nobody", decision: "reject" }] }).outcome).toBe("pending");
  });

  it("the same person approving twice counts once", () => {
    const r = rule({ requirements: [{ role: "technical", min: 2 }] });
    expect(evaluateApproval({ ...base, rule: r, decisions: [{ userId: "ana", decision: "approve" }, { userId: "ana", decision: "approve" }] }).outcome).toBe("pending");
  });
});

describe("unreachableReason", () => {
  it("is null when the people exist, without counting the requester", () => {
    expect(unreachableReason({ rule: rule(), requestedBy: "zoe", extraApprovers: [], people })).toBeNull();
  });

  it("detects a profile with too few other people", () => {
    expect(unreachableReason({ rule: rule({ requirements: [{ role: "technical", min: 2 }] }), requestedBy: "ana", extraApprovers: [], people })).toMatch(/only 1/);
  });

  it("detects a required approver who cannot approve", () => {
    expect(unreachableReason({ rule: rule({ approvers: ["ghost"] }), requestedBy: "zoe", extraApprovers: [], people })).toMatch(/required approver/);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  it("only live requests expire", () => {
    expect(isExpired({ status: "pending", expiresAt: "2026-10-09T00:00:00Z" }, now)).toBe(true);
    expect(isExpired({ status: "pending", expiresAt: "2026-10-11T00:00:00Z" }, now)).toBe(false);
    expect(isExpired({ status: "executed", expiresAt: "2026-10-09T00:00:00Z" }, now)).toBe(false);
  });
});
