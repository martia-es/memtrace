/**
 * Contra un Postgres real (15+) con las migraciones 001-039 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 039 (una fila por experimento, tipo y clave; una edición
 * que no dice nada no se guarda), el upsert, el borrado en cascada con el experimento y la semilla del permiso (ADR-077).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresChartCatalogRepository } from "@/adapters/outbound/postgres/postgres-chart-catalog-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { ChartCatalogService } from "@/application/chart-catalog-service";
import { ValidationError } from "@/domain/errors";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("chart catalog (postgres)", () => {
  let pool: Pool;
  let service: ChartCatalogService;
  let orgId: string;
  let agentA: string;
  let agentB: string;
  let userId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const identity = new PostgresIdentityRepository(pool);
    service = new ChartCatalogService(new PostgresChartCatalogRepository(pool));
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`catalog-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`catalog-org-${stamp}`, userId)).id;
    agentA = (await identity.createExperiment(orgId, "weather", `weather-${stamp}`)).id;
    agentB = (await identity.createExperiment(orgId, "geo", `geo-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds the permission: technical and business manage the catalog, org_admin does not", async () => {
    const { rows } = await pool.query<{ role_name: string }>(`SELECT role_name FROM role_permissions WHERE permission = 'catalog:manage'`);
    const roles = rows.map((r) => r.role_name).sort();
    expect(roles).toEqual(["business", "technical"]);
  });

  it("stores a name per experiment, kind and key, and replaces it when saved again", async () => {
    const first = await service.save(agentA, userId, { kind: "step", key: "input_guardrail", displayName: "Personal data filter" });
    expect(first).toMatchObject({ kind: "step", key: "input_guardrail", displayName: "Personal data filter", visibility: "auto", updatedBy: userId });
    await service.save(agentA, userId, { kind: "step", key: "input_guardrail", displayName: "PII filter", visibility: "shown" });
    const list = await service.list(agentA);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayName: "PII filter", visibility: "shown" });
  });

  it("keeps the experiments apart", async () => {
    await service.save(agentB, userId, { kind: "step", key: "input_guardrail", displayName: "Other name" });
    expect((await service.list(agentA))[0]!.displayName).toBe("PII filter");
    expect((await service.list(agentB))[0]!.displayName).toBe("Other name");
  });

  it("refuses a repeated name for the same kind inside an experiment", async () => {
    await expect(service.save(agentA, userId, { kind: "step", key: "other_step", displayName: "pii FILTER" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the database itself refuses a row that says nothing, a bad kind and an empty name", async () => {
    await expect(pool.query(`INSERT INTO chart_catalog_entries (experiment_id, kind, key) VALUES ($1, 'step', 'nothing')`, [agentA])).rejects.toBeDefined();
    await expect(pool.query(`INSERT INTO chart_catalog_entries (experiment_id, kind, key, display_name) VALUES ($1, 'span', 'k', 'x')`, [agentA])).rejects.toBeDefined();
    await expect(pool.query(`INSERT INTO chart_catalog_entries (experiment_id, kind, key, display_name) VALUES ($1, 'step', 'k', '   ')`, [agentA])).rejects.toBeDefined();
  });

  it("an edit that only hides keeps the row without a name, and going back to automatic deletes it", async () => {
    const hidden = await service.save(agentA, userId, { kind: "attribute", key: "customer_id", visibility: "hidden" });
    expect(hidden).toMatchObject({ displayName: null, visibility: "hidden" });
    expect(await service.save(agentA, userId, { kind: "attribute", key: "customer_id", visibility: "auto" })).toBeNull();
    expect((await service.list(agentA)).some((e) => e.key === "customer_id")).toBe(false);
    expect(await service.remove(agentA, "step", "input_guardrail")).toBe(true);
    expect(await service.remove(agentA, "step", "input_guardrail")).toBe(false);
  });

  it("answers nothing, instead of failing, for an id that is not a uuid", async () => {
    expect(await service.list("not-a-uuid")).toEqual([]);
    expect(await service.remove("not-a-uuid", "step", "k")).toBe(false);
  });

  it("is removed with its experiment", async () => {
    await service.save(agentB, userId, { kind: "attribute", key: "city", displayName: "City" });
    await pool.query(`DELETE FROM experiments WHERE id = $1`, [agentB]);
    const { rows } = await pool.query(`SELECT 1 FROM chart_catalog_entries WHERE experiment_id = $1`, [agentB]);
    expect(rows).toHaveLength(0);
  });
});
