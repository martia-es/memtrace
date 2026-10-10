/**
 * Contra un Postgres real con las migraciones aplicadas (hasta la 039). Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: que el registro es append-only y que el cliente ve cuándo una consultora entró en sus datos (ADR-093).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresPartnershipRepository } from "@/adapters/outbound/postgres/postgres-partnership-repository";
import { AuditService } from "@/application/audit-service";
import { PartnershipService } from "@/application/partnership-service";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("audit log (postgres)", () => {
  let pool: Pool;
  let audit: AuditService;
  let identity: PostgresIdentityRepository;
  let partnerships: PartnershipService;
  const stamp = Date.now();
  let admin: string, ana: string, c1: string, c2: string, p: string, exp: string;
  const newUser = async (name: string) => (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${name}-${stamp}@example.com`])).rows[0]!.id;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    audit = new AuditService(new PostgresAuditRepository(pool));
    identity = new PostgresIdentityRepository(pool);
    partnerships = new PartnershipService(new PostgresPartnershipRepository(pool), audit);
    admin = await newUser("admin");
    ana = await newUser("ana");
    c1 = (await identity.createOrganization(`audit-c1-${stamp}`, admin)).id;
    c2 = (await identity.createOrganization(`audit-c2-${stamp}`, admin)).id;
    p = (await identity.createOrganization(`audit-p-${stamp}`, admin)).id;
    await pool.query(`INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'governance')`, [p, ana]);
    exp = (await identity.createExperiment(c1, "bot", `audit-bot-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it("is append-only: rows can be neither changed nor deleted", async () => {
    await audit.record({ action: "api_key.created", actorUserId: admin, actorEmail: "x@y.z", organizationId: c1, experimentId: exp, targetType: "api_key", targetId: "k1", detail: { keyPrefix: "mtk_abc" } });
    await expect(pool.query(`UPDATE audit_events SET action = 'api_key.revoked' WHERE organization_id = $1`, [c1])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_events WHERE organization_id = $1`, [c1])).rejects.toThrow(/append-only/);
  });

  it("survives the deletion of the experiment and keeps who did it", async () => {
    const tmp = (await identity.createExperiment(c2, "tmp", `audit-tmp-${stamp}`)).id;
    await audit.record({ action: "member.added", actorUserId: admin, actorEmail: `admin-${stamp}@example.com`, organizationId: c2, experimentId: tmp });
    await pool.query(`DELETE FROM experiments WHERE id = $1`, [tmp]);
    const events = await audit.listForOrganization(c2, { action: "member.added" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ experimentId: tmp, actorEmail: `admin-${stamp}@example.com` });
  });

  it("shows a client what it granted, revoked, and when the consultancy entered its data", async () => {
    const actor = { id: admin, email: `admin-${stamp}@example.com` };
    const { id } = await partnerships.create(c1, p, actor);
    const grant = await partnerships.grant(c1, id, { email: `ana-${stamp}@example.com`, role: "business", experimentId: null }, actor);

    // lo que haría requirePermission cuando entra la persona de la consultora
    const access = await identity.resolveExperimentAccess(ana, exp);
    expect(access?.viaPartner).toBe(true);
    await audit.recordPartnerAccess({ userId: ana, email: `ana-${stamp}@example.com` }, { id: exp, organizationId: c1 });
    await audit.recordPartnerAccess({ userId: ana, email: `ana-${stamp}@example.com` }, { id: exp, organizationId: c1 }); // dentro de la ventana: no se repite

    await partnerships.revokeGrant(c1, id, grant.id, actor);
    await partnerships.revoke(c1, id, actor);

    const events = await audit.listForOrganization(c1);
    const actions = events.map((e) => e.action);
    expect(actions.filter((a) => a === "partner.access")).toHaveLength(1);
    for (const expected of ["partnership.created", "partner_grant.created", "partner.access", "partner_grant.revoked", "partnership.revoked", "api_key.created"]) {
      expect(actions).toContain(expected);
    }
    expect(events[0]!.at >= events[events.length - 1]!.at).toBe(true); // más recientes primero
    const created = events.find((e) => e.action === "partner_grant.created")!;
    expect(created.detail).toMatchObject({ role: "business", scope: "organization" });
    expect(JSON.stringify(events)).not.toMatch(/mtk_[A-Za-z0-9_-]{20,}/); // nunca el valor de una clave
  });

  it("does not leak one organization's events to another", async () => {
    const other = await audit.listForOrganization(c2);
    expect(other.every((e) => e.organizationId === c2)).toBe(true);
    expect(other.some((e) => e.action === "partner.access")).toBe(false);
  });

  it("filters by action and pages backwards", async () => {
    const all = await audit.listForOrganization(c1, { limit: 2 });
    expect(all).toHaveLength(2);
    const older = await audit.listForOrganization(c1, { limit: 50, before: all[1]!.at });
    expect(older.every((e) => e.at < all[1]!.at)).toBe(true);
    expect((await audit.listForOrganization(c1, { action: "partner.access" })).every((e) => e.action === "partner.access")).toBe(true);
  });

  it("a person who only holds a membership of the client is not flagged as partner access", async () => {
    const own = await newUser("own");
    await pool.query(`INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, 'technical')`, [exp, own]);
    expect((await identity.resolveExperimentAccess(own, exp))?.viaPartner).toBeUndefined();
  });
});
