/**
 * Contra un Postgres real con las migraciones aplicadas (hasta la 043). Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Una consultora (P) con dos personas opera a dos clientes (C1, C2) sin que ser de la consultora dé acceso a nada: el
 * aislamiento entre clientes lo decide cada cliente (ADR-091).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresPartnershipRepository } from "@/adapters/outbound/postgres/postgres-partnership-repository";
import { PostgresAuditRepository } from "@/adapters/outbound/postgres/postgres-audit-repository";
import { AuditService } from "@/application/audit-service";
import { AuthorizationService } from "@/application/authorization-service";
import { PartnershipService } from "@/application/partnership-service";
import { PartnershipInvariantError, PartnershipNotFoundError, ValidationError } from "@/domain/errors";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("partnerships (postgres)", () => {
  let pool: Pool;
  let identity: PostgresIdentityRepository;
  let authz: AuthorizationService;
  let service: PartnershipService;
  const stamp = Date.now();
  let c1Admin: string, c2Admin: string, pAdmin: string, ana: string, luis: string, stranger: string;
  let c1: string, c2: string, p: string;
  let c1Exp1: string, c1Exp2: string, c2Exp: string;

  const newUser = async (name: string) => (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${name}-${stamp}@example.com`])).rows[0]!.id;
  const email = (name: string) => `${name}-${stamp}@example.com`;
  const as = (id: string, name: string) => ({ id, email: email(name) });
  const access = (user: string, exp: string) => identity.resolveExperimentAccess(user, exp);
  const visible = async (user: string) => (await identity.listExperimentsForUser(user)).map((e) => e.id).sort();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    identity = new PostgresIdentityRepository(pool);
    authz = new AuthorizationService(identity);
    service = new PartnershipService(new PostgresPartnershipRepository(pool), new AuditService(new PostgresAuditRepository(pool)));
    [c1Admin, c2Admin, pAdmin, ana, luis, stranger] = await Promise.all(["c1admin", "c2admin", "padmin", "ana", "luis", "stranger"].map(newUser)) as [string, string, string, string, string, string];
    c1 = (await identity.createOrganization(`client-1-${stamp}`, c1Admin)).id;
    c2 = (await identity.createOrganization(`client-2-${stamp}`, c2Admin)).id;
    p = (await identity.createOrganization(`consulting-${stamp}`, pAdmin)).id;
    // las personas de la consultora son miembros de SU organización, con el rol más bajo que existe a ese nivel
    for (const u of [ana, luis]) await pool.query(`INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'governance')`, [p, u]);
    c1Exp1 = (await identity.createExperiment(c1, "bot", `bot-${stamp}`)).id;
    c1Exp2 = (await identity.createExperiment(c1, "sales", `sales-${stamp}`)).id;
    c2Exp = (await identity.createExperiment(c2, "bot", `bot-${stamp}`)).id; // mismo servicio que el de C1
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[c1, c2, p]]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@example.com`]);
    await pool.end();
  });

  it("being staff of the consultancy gives access to nothing", async () => {
    for (const exp of [c1Exp1, c1Exp2, c2Exp]) expect(await access(ana, exp)).toBeNull();
    expect(await visible(ana)).toEqual([]);
    expect(await service.clientsOf(ana)).toEqual([]);
  });

  it("a relationship alone grants nothing either", async () => {
    await service.create(c1, p, as(c1Admin, "c1admin"));
    expect(await access(ana, c1Exp1)).toBeNull();
    expect(await visible(ana)).toEqual([]);
  });

  describe("with grants", () => {
    let partnershipId: string;
    beforeAll(async () => {
      partnershipId = (await service.list(c1))[0]!.id;
    });

    it("gives an experiment role to a named person on the whole client, and only on that client", async () => {
      await service.grant(c1, partnershipId, { email: email("ana"), role: "business", experimentId: null }, as(c1Admin, "c1admin"));
      const onC1 = await access(ana, c1Exp1);
      expect(onC1?.role).toBe("business");
      expect(onC1?.permissions).toEqual(expect.arrayContaining(["experiment:read", "annotation:write"]));
      expect(onC1?.permissions).not.toContain("org:manage");
      expect(onC1?.permissions).not.toContain("apikey:manage_all");
      expect(onC1?.permissions).not.toContain("deploy:run");
      expect(await access(ana, c1Exp2)).not.toBeNull();
      expect(await access(ana, c2Exp)).toBeNull(); // otro cliente, aunque comparta nombre de servicio
      expect(await visible(ana)).toEqual([c1Exp1, c1Exp2].sort());
    });

    it("does not extend to a colleague who was not named", async () => {
      expect(await access(luis, c1Exp1)).toBeNull();
      expect(await visible(luis)).toEqual([]);
    });

    it("never makes the partner an administrator of the client", async () => {
      expect(await authz.canManageOrganization(ana, c1)).toBe(false);
      expect(await authz.canInOrganization(ana, c1, "experiment:create")).toBe(false);
    });

    it("scopes a grant to one experiment and unions it with a wider one", async () => {
      await service.grant(c1, partnershipId, { email: email("luis"), role: "technical", experimentId: c1Exp2 }, as(c1Admin, "c1admin"));
      expect((await access(luis, c1Exp2))?.permissions).toContain("trace:read_technical");
      expect(await access(luis, c1Exp1)).toBeNull();
      expect(await visible(luis)).toEqual([c1Exp2]);

      await service.grant(c1, partnershipId, { email: email("ana"), role: "technical", experimentId: c1Exp2 }, as(c1Admin, "c1admin"));
      expect((await access(ana, c1Exp2))?.permissions).toContain("trace:read_technical"); // técnico en el experimento concreto
      expect((await access(ana, c1Exp1))?.permissions).not.toContain("trace:read_technical"); // y solo business en el resto
    });

    it("changes the role when the same person and scope are granted again", async () => {
      await service.grant(c1, partnershipId, { email: email("luis"), role: "business", experimentId: c1Exp2 }, as(c1Admin, "c1admin"));
      expect((await access(luis, c1Exp2))?.permissions).not.toContain("trace:read_technical");
      expect((await service.list(c1))[0]!.grants.filter((g) => g.userId === luis)).toHaveLength(1);
    });

    it("lists for the consultancy person only the clients and experiments granted, as metadata", async () => {
      const clients = await service.clientsOf(ana);
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({ organizationId: c1 });
      expect(clients[0]!.experiments.map((e) => e.id).sort()).toEqual([c1Exp1, c1Exp2].sort());
      expect(await service.clientsOf(stranger)).toEqual([]);
    });

    it("rejects roles of organization level, strangers and experiments of other clients", async () => {
      await expect(service.grant(c1, partnershipId, { email: email("ana"), role: "org_admin", experimentId: null }, as(c1Admin, "c1admin"))).rejects.toBeInstanceOf(ValidationError);
      await expect(service.grant(c1, partnershipId, { email: email("stranger"), role: "business", experimentId: null }, as(c1Admin, "c1admin"))).rejects.toBeInstanceOf(PartnershipInvariantError);
      await expect(service.grant(c1, partnershipId, { email: email("ana"), role: "business", experimentId: c2Exp }, as(c1Admin, "c1admin"))).rejects.toBeInstanceOf(ValidationError);
    });

    it("another client cannot see or use this relationship", async () => {
      expect(await service.list(c2)).toEqual([]);
      await expect(service.grant(c2, partnershipId, { email: email("ana"), role: "business", experimentId: null }, as(c2Admin, "c2admin"))).rejects.toBeInstanceOf(PartnershipNotFoundError);
      await expect(service.revoke(c2, partnershipId, as(c2Admin, "c2admin"))).rejects.toBeInstanceOf(PartnershipNotFoundError);
    });

    it("removing someone from the consultancy takes away their access to every client at once", async () => {
      expect(await access(ana, c1Exp1)).not.toBeNull();
      await pool.query(`DELETE FROM org_memberships WHERE organization_id = $1 AND user_id = $2`, [p, ana]);
      expect(await access(ana, c1Exp1)).toBeNull();
      expect(await visible(ana)).toEqual([]);
      expect(await service.clientsOf(ana)).toEqual([]);
      expect((await service.list(c1))[0]!.grants.some((g) => g.userId === ana)).toBe(false);
    });

    it("does not bring the access back if the person is added to the consultancy again", async () => {
      await pool.query(`INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'governance')`, [p, ana]);
      expect(await access(ana, c1Exp1)).toBeNull();
      expect(await visible(ana)).toEqual([]);
      // el cliente puede volver a concederlo expresamente
      await service.grant(c1, partnershipId, { email: email("ana"), role: "business", experimentId: null }, as(c1Admin, "c1admin"));
      expect(await access(ana, c1Exp1)).not.toBeNull();
    });

    it("revoking a grant takes effect immediately and keeps the history", async () => {
      const grant = (await service.list(c1))[0]!.grants.find((g) => g.userId === luis)!;
      await service.revokeGrant(c1, partnershipId, grant.id, as(c1Admin, "c1admin"));
      expect(await access(luis, c1Exp2)).toBeNull();
      const { rows } = await pool.query(`SELECT revoked_at, revoked_by FROM partner_grants WHERE id = $1`, [grant.id]);
      expect(rows[0]).toMatchObject({ revoked_by: c1Admin });
      expect(rows[0].revoked_at).not.toBeNull();
    });

    it("revoking the relationship cuts every grant, and a new relationship does not resurrect them", async () => {
      expect(await access(ana, c1Exp1)).not.toBeNull();
      await service.revoke(c1, partnershipId, as(c1Admin, "c1admin"));
      expect(await access(ana, c1Exp1)).toBeNull();
      expect(await visible(ana)).toEqual([]);
      expect(await service.list(c1)).toEqual([]);

      const again = await service.create(c1, p, as(c1Admin, "c1admin"));
      expect(again.grants).toEqual([]);
      expect(await access(ana, c1Exp1)).toBeNull();
    });
  });

  it("an organization can be a client of several consultancies and a consultancy can serve several clients", async () => {
    const second = await service.create(c2, p, as(c2Admin, "c2admin"));
    await service.grant(c2, second.id, { email: email("luis"), role: "business", experimentId: null }, as(c2Admin, "c2admin"));
    expect(await access(luis, c2Exp)).not.toBeNull();
    expect(await access(luis, c1Exp1)).toBeNull(); // C1 no se lo ha dado
    expect((await service.clientsOf(luis)).map((c) => c.organizationId)).toEqual([c2]);
  });
});
