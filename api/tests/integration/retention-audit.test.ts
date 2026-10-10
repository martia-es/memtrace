/**
 * Contra un Postgres real (15+) con las migraciones 001-041 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 040 (rango 1-365), el recorte de overrides al acortar la
 * organización, el plazo efectivo del worker de purga, las semillas de permisos y la tabla append-only de auditoría (ADR-080).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresRetentionRepository } from "@/adapters/outbound/postgres/postgres-retention-repository";
import { AuditService } from "@/application/audit-service";
import { RetentionService } from "@/application/retention-service";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("retention and audit (postgres)", () => {
  let pool: Pool;
  let retention: RetentionService;
  let audit: AuditService;
  let repo: PostgresRetentionRepository;
  let orgId: string;
  let otherOrgId: string;
  let expA: string;
  let expB: string;
  let userId: string;
  const stamp = Date.now();
  const svcA = `ret-a-${stamp}`;
  const svcB = `ret-b-${stamp}`;
  const actor = () => ({ userId, email: `ret-${stamp}@example.com` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const identity = new PostgresIdentityRepository(pool);
    repo = new PostgresRetentionRepository(pool);
    audit = new AuditService(new PostgresAuditRepository(pool));
    retention = new RetentionService(repo, audit);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`ret-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`ret-org-${stamp}`, userId)).id;
    otherOrgId = (await identity.createOrganization(`ret-other-${stamp}`, userId)).id;
    expA = (await identity.createExperiment(orgId, "a", svcA)).id;
    expB = (await identity.createExperiment(orgId, "b", svcB)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [`ret-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds the permissions: org_admin sets retention and reads the log, technical exports, nobody else", async () => {
    const { rows } = await pool.query<{ role_name: string; permission: string }>(
      `SELECT role_name, permission FROM role_permissions WHERE permission IN ('retention:manage','audit:read','data:export') ORDER BY 1, 2`,
    );
    expect(rows.map((r) => `${r.role_name}:${r.permission}`)).toEqual(["org_admin:audit:read", "org_admin:retention:manage", "technical:data:export"]);
  });

  it("starts at 30 days with no overrides", async () => {
    const policy = await retention.getPolicy(orgId);
    expect(policy.defaultDays).toBe(30);
    expect(policy.experiments.map((e) => [e.name, e.overrideDays, e.effectiveDays])).toEqual([["a", null, 30], ["b", null, 30]]);
  });

  it("the database refuses a retention outside 1-365 even if the application did not", async () => {
    await expect(pool.query(`UPDATE organizations SET trace_retention_days = 0 WHERE id = $1`, [orgId])).rejects.toThrow();
    await expect(pool.query(`UPDATE experiments SET trace_retention_days = 366 WHERE id = $1`, [expA])).rejects.toThrow();
  });

  it("overrides shorten, shortening the organization trims longer overrides, and another organization's experiment is untouched", async () => {
    await retention.setOrganizationDefault(orgId, 90, actor());
    await retention.setExperimentOverride(orgId, expA, 60, actor());
    await retention.setExperimentOverride(orgId, expB, 7, actor());
    let policy = await retention.getPolicy(orgId);
    expect(policy.experiments.map((e) => e.effectiveDays)).toEqual([60, 7]);

    await retention.setOrganizationDefault(orgId, 30, actor());
    policy = await retention.getPolicy(orgId);
    expect(policy.experiments.map((e) => [e.overrideDays, e.effectiveDays])).toEqual([[null, 30], [7, 7]]);

    await expect(retention.setExperimentOverride(otherOrgId, expA, 5, actor())).rejects.toThrow("not found");
    expect((await retention.getPolicy(orgId)).experiments.find((e) => e.experimentId === expA)!.overrideDays).toBeNull();
  });

  it("the purge worker sees the effective retention per service", async () => {
    const targets = (await repo.listPurgeTargets()).filter((t) => [svcA, svcB].includes(t.serviceName));
    expect(targets.map((t) => [t.serviceName, t.days]).sort()).toEqual([[svcA, 30], [svcB, 7]]);
  });

  it("two organizations sharing a service.name get the LONGEST retention, never a destructive one", async () => {
    const identity = new PostgresIdentityRepository(pool);
    const shared = `ret-shared-${stamp}`;
    const e1 = (await identity.createExperiment(orgId, "shared1", shared)).id;
    const e2 = (await identity.createExperiment(otherOrgId, "shared2", shared)).id;
    await repo.setExperimentOverride(orgId, e1, 5);
    await retention.setOrganizationDefault(otherOrgId, 120, actor());
    const targets = (await repo.listPurgeTargets()).filter((t) => t.serviceName === shared);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ days: 120, experimentId: e2 });
    expect(e1).not.toBe(e2);
  });

  it("the changes above left an audit trail, newest first, filterable and paginated", async () => {
    const all = await audit.list(orgId, { action: "retention.update" }, { limit: 3 });
    expect(all.items).toHaveLength(3);
    expect(all.nextCursor).not.toBeNull();
    expect(all.items[0]!.actorLabel).toBe(`ret-${stamp}@example.com`);
    const next = await audit.list(orgId, { action: "retention.update" }, { limit: 50, cursor: all.nextCursor! });
    expect(next.items.length).toBeGreaterThan(0);
    expect(Number(next.items[0]!.id)).toBeLessThan(Number(all.items[2]!.id));
    expect((await audit.list(orgId, { experimentId: expB })).items.every((e) => e.experimentId === expB)).toBe(true);
    expect((await audit.list(otherOrgId, { experimentId: expB })).items).toHaveLength(0);
  });

  it("an audit entry survives the deletion of its actor, and old entries can be purged by age", async () => {
    const ghost = (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`ghost-${stamp}@example.com`])).rows[0]!.id;
    await audit.record({ organizationId: orgId, experimentId: null, actorUserId: ghost, actorLabel: `ghost-${stamp}@example.com`, action: "member.add", targetType: "user", targetId: ghost, metadata: {} });
    await pool.query(`DELETE FROM users WHERE id = $1`, [ghost]);
    const found = (await audit.list(orgId, { action: "member.add" })).items.find((e) => e.targetId === ghost)!;
    expect(found.actorUserId).toBeNull();
    expect(found.actorLabel).toBe(`ghost-${stamp}@example.com`);

    await pool.query(`UPDATE audit_log SET at = now() - interval '400 days' WHERE id = $1`, [found.id]);
    expect(await audit.purgeOlderThan(new Date(Date.now() - 365 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await audit.list(orgId, { action: "member.add" })).items.find((e) => e.targetId === ghost)).toBeUndefined();
  });
});
