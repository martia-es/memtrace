import { describe, expect, it } from "vitest";
import { desiredGrants, readGroupsClaim, type ExternalMapping } from "@/domain/external-access";
import { groupMemberPatch, parseBoolean, parseEqFilter, readUserBody, userPatch } from "@/domain/scim";

const map = (externalGroup: string, role: string, experimentId: string | null = "e1"): ExternalMapping => ({ id: `${externalGroup}-${role}`, organizationId: "o1", externalGroup, experimentId, role, createdAt: "" });

describe("readGroupsClaim", () => {
  it("reads a list, a single string, and an empty list as real information", () => {
    expect(readGroupsClaim({ groups: ["a", "b"] }, "groups")).toEqual(["a", "b"]);
    expect(readGroupsClaim({ roles: "admins" }, "roles")).toEqual(["admins"]);
    expect(readGroupsClaim({ groups: [] }, "groups")).toEqual([]);
  });

  it("returns null, so nothing is removed, when the token does not say (no claim, or Entra's group overage)", () => {
    expect(readGroupsClaim({ email: "a@x.com" }, "groups")).toBeNull();
    expect(readGroupsClaim(null, "groups")).toBeNull();
    expect(readGroupsClaim({ _claim_names: { groups: "src1" } }, "groups")).toBeNull();
  });
});

describe("desiredGrants", () => {
  const weight = (role: string) => ({ technical: 8, business: 2, org_admin: 4 })[role] ?? 0;

  it("gives the roles of the groups the person is in, and nothing for the rest", () => {
    const grants = desiredGrants([map("ai-team", "technical"), map("sales", "business", "e2")], ["ai-team"], weight);
    expect(grants).toEqual([{ experimentId: "e1", role: "technical" }]);
  });

  it("keeps the role with more permissions when two groups give different roles in the same experiment", () => {
    const grants = desiredGrants([map("a", "business"), map("b", "technical")], ["a", "b"], weight);
    expect(grants).toEqual([{ experimentId: "e1", role: "technical" }]);
  });

  it("supports an organization-level role next to an experiment role", () => {
    const grants = desiredGrants([map("admins", "org_admin", null), map("ai-team", "technical")], ["admins", "ai-team"], weight);
    expect(grants).toHaveLength(2);
  });
});

describe("SCIM parsing", () => {
  it("reads the eq filter IdPs send when syncing", () => {
    expect(parseEqFilter('userName eq "ana@x.com"')).toEqual({ attribute: "userName", value: "ana@x.com" });
    expect(parseEqFilter('displayName eq "AI \\"core\\""')).toEqual({ attribute: "displayName", value: 'AI "core"' });
    expect(parseEqFilter("userName co ana")).toBeNull();
  });

  it("accepts Entra's text booleans", () => {
    expect(parseBoolean("False")).toBe(false);
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean("maybe")).toBeNull();
  });

  it("reads the deactivation however each vendor sends it", () => {
    expect(userPatch([{ op: "Replace", path: "active", value: "False" }])).toEqual({ active: false });
    expect(userPatch([{ op: "replace", value: { active: false, displayName: "Ana" } }])).toEqual({ active: false, displayName: "Ana" });
  });

  it("reads membership changes: add, remove by filter, replace and remove-all", () => {
    expect(groupMemberPatch([{ op: "add", path: "members", value: [{ value: "u1" }, { value: "u2" }] }]).add).toEqual(["u1", "u2"]);
    expect(groupMemberPatch([{ op: "remove", path: 'members[value eq "u1"]' }]).remove).toEqual(["u1"]);
    expect(groupMemberPatch([{ op: "replace", path: "members", value: [{ value: "u3" }] }]).replace).toEqual(["u3"]);
    expect(groupMemberPatch([{ op: "remove", path: "members" }]).replace).toEqual([]);
  });

  it("builds a user from the body, falling back to the primary email for userName", () => {
    expect(readUserBody({ userName: "ana@x.com", name: { givenName: "Ana", familyName: "Ruiz" }, active: "False" })).toMatchObject({ userName: "ana@x.com", displayName: "Ana Ruiz", active: false });
    expect(readUserBody({ emails: [{ value: "b@x.com", primary: true }] }).userName).toBe("b@x.com");
  });
});
