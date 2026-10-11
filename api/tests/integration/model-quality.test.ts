/**
 * Contra un Postgres real (15+) con las migraciones 001-048 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones y el índice único de la migración 048 y las cascadas (ADR-025).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresModelQualityRepository } from "@/adapters/outbound/postgres/postgres-model-quality-repository";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("model quality matches (postgres)", () => {
  let pool: Pool;
  let repo: PostgresModelQualityRepository;
  let orgA: string;
  let orgB: string;
  let userId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const identity = new PostgresIdentityRepository(pool);
    repo = new PostgresModelQualityRepository(pool);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`quality-${stamp}@example.com`])).rows[0]!.id;
    orgA = (await identity.createOrganization(`quality-a-${stamp}`, userId)).id;
    orgB = (await identity.createOrganization(`quality-b-${stamp}`, userId)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [`quality-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds the permission: only technical decides matches", async () => {
    const { rows } = await pool.query<{ role_name: string }>(`SELECT role_name FROM role_permissions WHERE permission = 'pricing:manage'`);
    expect(rows.map((r) => r.role_name)).toEqual(["technical"]);
  });

  it("keeps one positive answer per organization and key: a new confirmation replaces the old one", async () => {
    await repo.confirm(orgA, "claude-sonnet-4-5", "claude-sonnet-4-5-20250929", userId);
    await repo.confirm(orgA, "claude-sonnet-4-5", "claude-sonnet-4-5-20250929-high-32k", userId);
    expect(await repo.listDecisions(orgA)).toEqual([{ modelKey: "claude-sonnet-4-5", arenaModelName: "claude-sonnet-4-5-20250929-high-32k", decision: "confirmed" }]);
    await repo.clear(orgA, "claude-sonnet-4-5");
  });

  it("confirming an entry that was rejected turns the rejection into a confirmation", async () => {
    await repo.reject(orgA, "gemini-3-flash-preview", ["gemini-3-flash", "gemini-3-flash (thinking-minimal)"], userId);
    await repo.confirm(orgA, "gemini-3-flash-preview", "gemini-3-flash", userId);
    expect(await repo.listDecisions(orgA)).toEqual([
      { modelKey: "gemini-3-flash-preview", arenaModelName: "gemini-3-flash", decision: "confirmed" },
      { modelKey: "gemini-3-flash-preview", arenaModelName: "gemini-3-flash (thinking-minimal)", decision: "rejected" },
    ]);
    await repo.clear(orgA, "gemini-3-flash-preview");
  });

  it("rejecting twice does not fail and does not duplicate", async () => {
    await repo.reject(orgA, "k", ["a", "b"], userId);
    await repo.reject(orgA, "k", ["b", "c"], userId);
    expect((await repo.listDecisions(orgA)).map((d) => d.arenaModelName)).toEqual(["a", "b", "c"]);
    await repo.reject(orgA, "k", [], userId);
    await repo.clear(orgA, "k");
  });

  it("no_equivalent replaces a confirmation and keeps the rejections", async () => {
    await repo.reject(orgA, "m", ["x"], userId);
    await repo.confirm(orgA, "m", "y", userId);
    await repo.setNoEquivalent(orgA, "m", userId);
    expect(await repo.listDecisions(orgA)).toEqual([
      { modelKey: "m", arenaModelName: "", decision: "no_equivalent" },
      { modelKey: "m", arenaModelName: "x", decision: "rejected" },
    ]);
    await repo.confirm(orgA, "m", "z", userId);
    expect((await repo.listDecisions(orgA)).map((d) => d.decision).sort()).toEqual(["confirmed", "rejected"]);
    await repo.clear(orgA, "m");
  });

  it("the database refuses what the service would never send", async () => {
    // dos respuestas positivas para la misma clave
    await pool.query(`INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision) VALUES ($1, 'dup', 'a', 'confirmed')`, [orgA]);
    await expect(pool.query(`INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision) VALUES ($1, 'dup', 'b', 'confirmed')`, [orgA])).rejects.toThrow();
    // «sin equivalente» apunta a una entrada, o una confirmación a ninguna
    await expect(pool.query(`INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision) VALUES ($1, 'bad', 'a', 'no_equivalent')`, [orgA])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision) VALUES ($1, 'bad', '', 'confirmed')`, [orgA])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision) VALUES ($1, 'bad', 'a', 'maybe')`, [orgA])).rejects.toThrow();
    await repo.clear(orgA, "dup");
  });

  it("decisions are per organization", async () => {
    await repo.confirm(orgA, "same-key", "entry", userId);
    expect(await repo.listDecisions(orgB)).toEqual([]);
    expect(await repo.clear(orgB, "same-key")).toBe(false);
    expect(await repo.listDecisions(orgA)).toHaveLength(1);
  });

  it("an id that is not a uuid is simply not found", async () => {
    expect(await repo.listDecisions("not-a-uuid")).toEqual([]);
    expect(await repo.clear("not-a-uuid", "k")).toBe(false);
  });

  it("deleting the organization deletes its decisions", async () => {
    await repo.confirm(orgB, "gone", "entry", userId);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgB]);
    const { rows } = await pool.query(`SELECT 1 FROM model_quality_matches WHERE organization_id = $1`, [orgB]);
    expect(rows).toEqual([]);
  });

  it("keeps the decision when the person who took it is deleted", async () => {
    const { rows } = await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Temp') RETURNING id`, [`quality-temp-${stamp}@example.com`]);
    await repo.confirm(orgA, "kept", "entry", rows[0]!.id);
    await pool.query(`DELETE FROM users WHERE id = $1`, [rows[0]!.id]);
    expect(await repo.listDecisions(orgA)).toContainEqual({ modelKey: "kept", arenaModelName: "entry", decision: "confirmed" });
  });
});
