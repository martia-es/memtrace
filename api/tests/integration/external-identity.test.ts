/**
 * Contra un Postgres real (15+) con las migraciones aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: que la conciliación no pise una membresía manual, que nunca deje una organización
 * sin org_admin, el enlace de usuarios SCIM por email y la unicidad de grupos y usuarios (ADR-052).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresExternalIdentityRepository } from "@/adapters/outbound/postgres/postgres-external-identity-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("external identity (postgres)", () => {
  let pool: Pool;
  let repo: PostgresExternalIdentityRepository;
  let identity: PostgresIdentityRepository;
  let orgId: string;
  let exp1: string;
  let exp2: string;
  let admin: string;
  const stamp = Date.now();

  const newUser = async (name: string) => (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${name}-${stamp}@example.com`])).rows[0]!.id;
  const roleIn = async (experimentId: string, userId: string) =>
    (await pool.query<{ role: string; source: string }>(`SELECT role, source FROM experiment_memberships WHERE experiment_id = $1 AND user_id = $2`, [experimentId, userId])).rows[0] ?? null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    repo = new PostgresExternalIdentityRepository(pool);
    identity = new PostgresIdentityRepository(pool);
    admin = await newUser("admin");
    orgId = (await identity.createOrganization("ext-org", admin)).id;
    exp1 = (await identity.createExperiment(orgId, "e1", `svc1-${stamp}`)).id;
    exp2 = (await identity.createExperiment(orgId, "e2", `svc2-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it("adds, changes and removes the roles an external source gave, in one reconciliation", async () => {
    const u = await newUser("ana");
    await repo.reconcile(u, orgId, "oidc", [{ experimentId: exp1, role: "technical" }, { experimentId: exp2, role: "business" }]);
    expect(await roleIn(exp1, u)).toEqual({ role: "technical", source: "oidc" });
    expect(await roleIn(exp2, u)).toEqual({ role: "business", source: "oidc" });
    await repo.reconcile(u, orgId, "oidc", [{ experimentId: exp1, role: "business" }]);
    expect(await roleIn(exp1, u)).toEqual({ role: "business", source: "oidc" });
    expect(await roleIn(exp2, u)).toBeNull();
  });

  it("never overwrites or removes a manual membership", async () => {
    const u = await newUser("manual");
    await identity.addExperimentMember(exp1, u, "technical");
    await repo.reconcile(u, orgId, "oidc", [{ experimentId: exp1, role: "business" }]);
    expect(await roleIn(exp1, u)).toEqual({ role: "technical", source: "manual" });
    await repo.reconcile(u, orgId, "oidc", []);
    expect(await roleIn(exp1, u)).toEqual({ role: "technical", source: "manual" });
  });

  it("only removes what its own source gave", async () => {
    const u = await newUser("two-sources");
    await repo.reconcile(u, orgId, "scim", [{ experimentId: exp1, role: "technical" }]);
    await repo.reconcile(u, orgId, "oidc", []);
    expect(await roleIn(exp1, u)).toEqual({ role: "technical", source: "scim" });
  });

  it("does not leave an organization without any org_admin", async () => {
    const solo = (await identity.createOrganization("solo-org", await newUser("solo"))).id;
    const ext = await newUser("ext-admin");
    await repo.reconcile(ext, solo, "oidc", [{ experimentId: null, role: "org_admin" }]);
    const count = async () => (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM org_memberships WHERE organization_id = $1`, [solo])).rows[0]!.n;
    expect(await count()).toBe(2);
    await repo.reconcile(ext, solo, "oidc", []);
    expect(await count()).toBe(1); // se retira al externo porque queda el manual
    const manual = (await pool.query<{ user_id: string }>(`SELECT user_id FROM org_memberships WHERE organization_id = $1`, [solo])).rows[0]!.user_id;
    await pool.query(`UPDATE org_memberships SET source = 'oidc' WHERE organization_id = $1 AND user_id = $2`, [solo, manual]);
    await repo.reconcile(manual, solo, "oidc", []);
    expect(await count()).toBe(1); // el único org_admin no se quita
  });

  it("validates mappings: role scope, experiment of the organization, duplicates", async () => {
    await expect(repo.createMapping(orgId, { externalGroup: "g", experimentId: exp1, role: "org_admin" })).rejects.toThrow();
    await expect(repo.createMapping(orgId, { externalGroup: "g", experimentId: null, role: "technical" })).rejects.toThrow();
    await expect(repo.createMapping(orgId, { externalGroup: "g", experimentId: "00000000-0000-0000-0000-000000000000", role: "technical" })).rejects.toThrow();
    const ok = await repo.createMapping(orgId, { externalGroup: "g", experimentId: exp1, role: "technical" });
    await expect(repo.createMapping(orgId, { externalGroup: "g", experimentId: exp1, role: "technical" })).rejects.toThrow();
    await repo.createMapping(orgId, { externalGroup: "g", experimentId: null, role: "org_admin" });
    expect(await repo.deleteMapping(orgId, ok.id)).toBe(true);
    expect(await repo.deleteMapping(orgId, ok.id)).toBe(false);
  });

  it("links SCIM users by email, now or at the first login, and lists their groups", async () => {
    const early = await repo.createScimUser(orgId, { userName: `Late-${stamp}@example.com`, externalId: null, displayName: "Late", active: true });
    expect(early!.userId).toBeNull();
    expect(await repo.createScimUser(orgId, { userName: `late-${stamp}@EXAMPLE.com`, externalId: null, displayName: null, active: true })).toBeNull();
    const userId = await newUser(`late`);
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [userId, `late-${stamp}@example.com`]);
    expect(await repo.linkScimUsersByEmail(userId, `late-${stamp}@example.com`)).toEqual([orgId]);

    const group = await repo.createScimGroup(orgId, { displayName: `ai-${stamp}`, externalId: `ext-${stamp}`, memberIds: [early!.id, "not-a-uuid"] });
    expect(group!.memberIds).toEqual([early!.id]);
    expect(await repo.createScimGroup(orgId, { displayName: `ai-${stamp}`, externalId: null, memberIds: [] })).toBeNull();
    const [m] = await repo.scimMemberships({ scimUserIds: [early!.id] });
    expect(m).toMatchObject({ userId, active: true });
    expect(m!.groups.sort()).toEqual([`ai-${stamp}`, `ext-${stamp}`].sort());

    const emptied = await repo.updateScimGroup(orgId, group!.id, { replace: [] });
    expect(emptied!.memberIds).toEqual([]);
    const deactivated = await repo.updateScimUser(orgId, early!.id, { active: false });
    expect(deactivated!.active).toBe(false);
  });

  it("authenticates SCIM tokens per organization and stops at revocation", async () => {
    const { token, plaintext } = await repo.createScimToken(orgId, admin);
    expect(await repo.resolveScimToken(plaintext)).toBe(orgId);
    expect(await repo.resolveScimToken("mtscim_nope")).toBeNull();
    expect(await repo.revokeScimToken(orgId, token.id)).toBe(true);
    expect(await repo.resolveScimToken(plaintext)).toBeNull();
  });
});
