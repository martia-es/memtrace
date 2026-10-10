import { describe, expect, it } from "vitest";
import { belowFloor, canDecideNow, daysLeft, describeRule, profileLabel, progressLines, requestTitle, ruleFor, sameRule, stepMode, steps, waitingOn } from "@/domain/approvals";
import { approvalRequest } from "../fakes-prompts";

const rule = (over = {}) => ({ action: "promote" as const, stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [] as string[], ...over });

describe("approval wording", () => {
  it("names the profiles, humanizing custom ones", () => {
    expect(profileLabel("technical")).toBe("Technical");
    expect(profileLabel("compliance_officer")).toBe("Compliance officer");
  });

  it("lists the steps to configure: publish first, then each environment in order", () => {
    expect(steps(["dev", "pre", "pro"]).map((s) => s.label)).toEqual(["Publish a version", "Move dev", "Move pre", "Move pro"]);
  });

  it("describes a rule in one line, and says when there is none", () => {
    expect(describeRule(null)).toBe("No approval needed");
    expect(describeRule(rule({ requirements: [{ role: "technical", min: 1 }, { role: "business", min: 2 }] }))).toBe("1 Technical + 2 Business");
    expect(describeRule(rule({ approvers: ["a"] }), { a: "Ana" })).toBe("1 Technical · always: Ana");
    expect(describeRule(rule({ requirements: [], approvers: ["a", "b"] }), { a: "Ana" })).toBe("always: Ana, someone");
  });

  it("finds the rule of a step", () => {
    const rules = [rule({ stage: "pre" }), rule()];
    expect(ruleFor(rules, "promote", "pro")).toBe(rules[1]);
    expect(ruleFor(rules, "publish", "")).toBeNull();
  });
});

describe("the organization's floor", () => {
  it("flags a rule that asks for less than the organization", () => {
    const floor = rule({ requirements: [{ role: "technical", min: 2 }], approvers: ["a"] });
    expect(belowFloor(rule({ requirements: [{ role: "technical", min: 1 }], approvers: ["a"] }), floor)).toMatch(/cannot ask for fewer/);
    expect(belowFloor(rule({ requirements: [{ role: "technical", min: 2 }], approvers: [] }), floor)).toMatch(/default approvers/);
    expect(belowFloor(rule({ requirements: [{ role: "technical", min: 3 }], approvers: ["a", "b"] }), floor)).toBeNull();
    expect(belowFloor(rule(), null)).toBeNull();
  });
});

describe("requests", () => {
  it("titles what the request asks", () => {
    expect(requestTitle({ action: "publish", version: 3, tag: "" })).toBe("Publish v3");
    expect(requestTitle({ action: "promote", version: 4, tag: "pro" })).toBe("Move pro to v4");
  });

  it("shows progress per profile, never above what is needed", () => {
    const r = approvalRequest({ evaluation: { outcome: "pending", roles: [{ role: "technical", need: 2, have: 1 }, { role: "business", need: 1, have: 3 }], missingApprovers: ["u1"], rejectedBy: null, reason: "" }, people: { u1: "Ben" } });
    expect(progressLines(r)).toEqual([
      { label: "Technical", have: 1, need: 2, done: false },
      { label: "Business", have: 1, need: 1, done: true },
    ]);
    expect(waitingOn(r)).toEqual(["Ben"]);
  });

  it("only offers the buttons to someone who can still decide", () => {
    const r = approvalRequest({ requestedBy: "me", decisions: [{ userId: "done", decision: "approve", comment: "", decidedAt: "t" }] });
    expect(canDecideNow(r, "other")).toBe(true);
    expect(canDecideNow(r, "me")).toBe(false); // la pidió
    expect(canDecideNow(r, "done")).toBe(false); // ya respondió
    expect(canDecideNow(r, null)).toBe(false);
    expect(canDecideNow({ ...r, status: "executed" }, "other")).toBe(false);
  });

  it("counts the days left before it expires", () => {
    const r = approvalRequest({ expiresAt: "2026-10-16T10:00:00.000Z" });
    expect(daysLeft(r, new Date("2026-10-09T10:00:00.000Z"))).toBe(7);
    expect(daysLeft(r, new Date("2026-10-20T10:00:00.000Z"))).toBe(0);
  });
});

describe("step modes", () => {
  it("is follow without an exemption, and own or none depending on whether the agent has a rule of its own", () => {
    expect(stepMode({ exempt: false, hasOwnRule: false })).toBe("follow");
    expect(stepMode({ exempt: false, hasOwnRule: true })).toBe("follow"); // una regla propia sin exención solo endurece
    expect(stepMode({ exempt: true, hasOwnRule: true })).toBe("own");
    expect(stepMode({ exempt: true, hasOwnRule: false })).toBe("none");
  });

  it("sameRule ignores order", () => {
    const a = { requirements: [{ role: "technical", min: 1 }, { role: "business", min: 2 }], approvers: ["x", "y"] };
    const b = { requirements: [{ role: "business", min: 2 }, { role: "technical", min: 1 }], approvers: ["y", "x"] };
    expect(sameRule(a, b)).toBe(true);
    expect(sameRule(a, { ...b, approvers: ["x"] })).toBe(false);
    expect(sameRule(a, { ...b, requirements: [{ role: "business", min: 3 }, { role: "technical", min: 1 }] })).toBe(false);
  });
});
