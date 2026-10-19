/**
 * Contra un Postgres real (15+) con las migraciones 001-051 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 051 (rango 1-365 y suelo del AI Act), el plazo por nivel que ve
 * el worker de purga, la propia migración, las semillas de permisos y la tabla append-only de auditoría (ADR-084, ADR-102).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresRetentionRepository } from "@/adapters/outbound/postgres/postgres-retention-repository";
import { AuditService } from "@/application/audit-service";
import { RetentionService } from "@/application/retention-service";
import { ValidationError } from "@/domain/errors";

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

  it("a new organization starts with 30 days, or the AI Act floor where there is one", async () => {
    const policy = await retention.getPolicy(orgId);
    expect(policy.levels.map((l) => [l.level, l.days])).toEqual([["high", 180], ["limited", 30], ["minimal", 30], ["unclassified", 180]]);
    expect(policy.agents.map((a) => [a.name, a.level, a.effectiveDays])).toEqual([["a", null, 180], ["b", null, 180]]);
  });

  it("the database refuses a period outside 1-365 or below the AI Act floor, even if the application did not", async () => {
    await expect(pool.query(`INSERT INTO risk_policies (organization_id, risk_level, retention_days) VALUES ($1, 'minimal', 0)`, [orgId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO risk_policies (organization_id, risk_level, retention_days) VALUES ($1, 'minimal', 366)`, [orgId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO risk_policies (organization_id, risk_level, retention_days) VALUES ($1, 'high', 179)`, [orgId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO risk_policies (organization_id, risk_level, retention_days) VALUES ($1, 'unclassified', 30)`, [orgId])).rejects.toThrow();
  });

  it("an agent keeps its traces for the period of its level, and changing its level changes it", async () => {
    await retention.setLevelDays(orgId, "minimal", 45, actor());
    await retention.setLevelDays(orgId, "high", 300, actor());
    await pool.query(`UPDATE experiments SET risk_level = 'minimal' WHERE id = $1`, [expA]);
    await pool.query(`UPDATE experiments SET risk_level = 'high' WHERE id = $1`, [expB]);
    const policy = await retention.getPolicy(orgId);
    expect(policy.agents.map((a) => [a.name, a.effectiveDays])).toEqual([["a", 45], ["b", 300]]);
    expect(policy.levels.map((l) => [l.level, l.agents])).toEqual([["high", 1], ["limited", 0], ["minimal", 1], ["unclassified", 0]]);
    await expect(retention.setLevelDays(orgId, "high", 100, actor())).rejects.toBeInstanceOf(ValidationError);
    await expect(retention.setLevelDays(otherOrgId, "minimal", 10, actor())).resolves.toBeDefined();
    expect((await retention.getPolicy(orgId)).levels.find((l) => l.level === "minimal")!.days).toBe(45);
  });

  it("the purge worker and the Errors-page lookup see the period of each agent's level", async () => {
    const targets = (await repo.listPurgeTargets()).filter((t) => [svcA, svcB].includes(t.serviceName));
    expect(targets.map((t) => [t.serviceName, t.days]).sort()).toEqual([[svcA, 45], [svcB, 300]]);
    expect(await repo.effectiveDaysForService(svcB)).toBe(300);
  });

  it("two organizations sharing a service.name get the LONGEST retention, never a destructive one", async () => {
    const identity = new PostgresIdentityRepository(pool);
    const shared = `ret-shared-${stamp}`;
    await identity.createExperiment(orgId, "shared1", shared);
    const e2 = (await identity.createExperiment(otherOrgId, "shared2", shared)).id;
    await pool.query(`UPDATE experiments SET risk_level = 'minimal' WHERE service_name = $1`, [shared]);
    await retention.setLevelDays(otherOrgId, "minimal", 120, actor());
    const targets = (await repo.listPurgeTargets()).filter((t) => t.serviceName === shared);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ days: 120, experimentId: e2 });
  });

  it("the migration moves the old period to the levels and records each dropped override in the audit log", async () => {
    // reproduce el estado anterior a la migración 051 en una organización nueva y vuelve a ejecutar sus sentencias de datos
    const identity = new PostgresIdentityRepository(pool);
    const org = (await identity.createOrganization(`ret-mig-${stamp}`, userId)).id;
    const exp = (await identity.createExperiment(org, "legacy", `ret-legacy-${stamp}`)).id;
    await pool.query(`DELETE FROM risk_policies WHERE organization_id = $1`, [org]);
    await pool.query(`UPDATE organizations SET trace_retention_days = 90 WHERE id = $1`, [org]);
    await pool.query(`UPDATE experiments SET trace_retention_days = 7 WHERE id = $1`, [exp]);
    const fs = await import("node:fs");
    const path = await import("node:path");
    await pool.query(fs.readFileSync(path.resolve(__dirname, "../../../migrations/postgres/051_risk_policies.sql"), "utf8"));
    const policy = await retention.getPolicy(org);
    expect(policy.levels.map((l) => [l.level, l.days])).toEqual([["high", 180], ["limited", 90], ["minimal", 90], ["unclassified", 180]]);
    expect((await pool.query(`SELECT trace_retention_days FROM experiments WHERE id = $1`, [exp])).rows[0].trace_retention_days).toBeNull();
    const entry = (await audit.list(org, { experimentId: exp })).items.find((e) => e.action === "retention.update")!;
    expect(entry).toMatchObject({ actorLabel: "system:migration", metadata: { droppedOverrideDays: 7 } });
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [org]);
  });

  it("the changes above left an audit trail, newest first, filterable and paginated", async () => {
    const all = await audit.list(orgId, { action: "retention.update" }, { limit: 1 });
    expect(all.items).toHaveLength(1);
    expect(all.nextCursor).not.toBeNull();
    expect(all.items[0]!.actorLabel).toBe(`ret-${stamp}@example.com`);
    const next = await audit.list(orgId, { action: "retention.update" }, { limit: 50, cursor: all.nextCursor! });
    expect(next.items.length).toBeGreaterThan(0);
    expect(Number(next.items[0]!.id)).toBeLessThan(Number(all.items[0]!.id));
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
