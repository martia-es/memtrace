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
    expect(role("business").permissions).toEqual(["experiment:read", "annotation:write"]);
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

  it("governance permissions (ADR-053): org_admin and governance see and decide, technical only maintains its own assistant", () => {
    expect(role("org_admin").permissions).toEqual(expect.arrayContaining(["governance:read", "governance:manage"]));
    expect(role("governance").scope).toBe("organization");
    expect(role("governance").permissions).toEqual(["governance:read", "governance:manage"]);
    expect(role("technical").permissions).toContain("assistant:manage");
    expect(role("technical").permissions).not.toContain("governance:manage");
    expect(role("business").permissions).not.toContain("assistant:manage");
  });
});
