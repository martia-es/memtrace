import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, PERMISSIONS, isPermission } from "@/domain/permissions";

const role = (name: string) => BUILT_IN_ROLES.find((r) => r.name === name)!;

describe("built-in roles (ADR-052)", () => {
  it("only grant permissions that exist", () => {
    for (const r of BUILT_IN_ROLES) for (const p of r.permissions) expect(PERMISSIONS).toContain(p);
    expect(isPermission("queue:curate")).toBe(true);
    expect(isPermission("queue:everything")).toBe(false);
  });

  it("business reads the dashboard and labels, but curates and configures nothing", () => {
    expect(role("business").permissions).toEqual(["experiment:read", "annotation:write", "prompt:read", "prompt:approve", "catalog:manage"]);
  });

  it("technical does the curation and keeps its own API key, but invites nobody", () => {
    const p = role("technical").permissions;
    expect(p).toEqual(expect.arrayContaining(["queue:curate", "queue:manage", "scoreconfig:manage", "dataset:write", "trace:read_technical", "apikey:manage_own"]));
    expect(p).not.toContain("member:manage");
    expect(p).not.toContain("apikey:manage_all");
  });

  it("org_admin manages people and keys but reads no data", () => {
    const p = role("org_admin").permissions;
    expect(p).toEqual(expect.arrayContaining(["member:manage", "apikey:manage_all", "experiment:create", "org:manage"]));
    expect(p).not.toContain("experiment:read");
    expect(p).not.toContain("annotation:write");
  });

  it("approvals (ADR-076): technical and business can approve, only org_admin defines the rules", () => {
    expect(role("technical").permissions).toContain("prompt:approve");
    expect(role("business").permissions).toContain("prompt:approve");
    expect(role("org_admin").permissions).toContain("approval:manage");
    expect(role("org_admin").permissions).not.toContain("prompt:approve");
    expect(role("technical").permissions).not.toContain("approval:manage");
    expect(role("business").permissions).not.toContain("approval:manage");
  });

  it("catalog (ADR-078): both working profiles can name and hide the items of the Custom charts, org_admin and governance cannot", () => {
    expect(role("technical").permissions).toContain("catalog:manage");
    expect(role("business").permissions).toContain("catalog:manage");
    expect(role("org_admin").permissions).not.toContain("catalog:manage");
    expect(role("governance").permissions).not.toContain("catalog:manage");
  });

  it("data protection (ADR-080): org_admin sets retention and reads the audit log but cannot export data, technical can", () => {
    expect(role("org_admin").permissions).toEqual(expect.arrayContaining(["retention:manage", "audit:read"]));
    expect(role("org_admin").permissions).not.toContain("data:export");
    expect(role("technical").permissions).toContain("data:export");
    expect(role("business").permissions).not.toContain("data:export");
  });

  it("governance permissions (ADR-053): org_admin and governance see and decide, technical only maintains its own assistant", () => {
    expect(role("org_admin").permissions).toEqual(expect.arrayContaining(["governance:read", "governance:manage"]));
    expect(role("governance").scope).toBe("organization");
    expect(role("governance").permissions).toEqual(["governance:read", "governance:manage", "prompt:read"]);
    expect(role("technical").permissions).toContain("assistant:manage");
    expect(role("technical").permissions).not.toContain("governance:manage");
    expect(role("business").permissions).not.toContain("assistant:manage");
  });
});
