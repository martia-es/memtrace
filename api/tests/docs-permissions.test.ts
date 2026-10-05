import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, PERMISSIONS } from "@/domain/permissions";

// La página «Roles & permissions» del sitio de documentación (docs-site) lee estos datos: si el catálogo o los roles
// de serie cambian en el código y no allí, la documentación miente. Este test lo impide.
const docs = JSON.parse(readFileSync(resolve(__dirname, "../../docs-site/.vitepress/theme/data/permissions.json"), "utf8")) as {
  permissions: { id: string; unlocks: string[] }[];
  roles: { id: string; permissions: string[] }[];
  actions: { permission: string }[];
};

describe("docs-site permissions data", () => {
  it("lists exactly the permission catalog of the code", () => {
    expect(docs.permissions.map((p) => p.id).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("gives every built-in role exactly the permissions of the code", () => {
    expect(docs.roles.map((r) => r.id).sort()).toEqual(BUILT_IN_ROLES.map((r) => r.name).sort());
    for (const role of BUILT_IN_ROLES) {
      expect(docs.roles.find((r) => r.id === role.name)!.permissions.sort()).toEqual([...role.permissions].sort());
    }
  });

  it("only uses permissions that exist in the simulator's actions", () => {
    for (const a of docs.actions) expect(PERMISSIONS).toContain(a.permission);
  });
});
