/**
 * Contra un Postgres real con las migraciones aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Verifica que una sesión de edición (ADR-041) crea UNA sola versión con bump y nota correctos.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("commitDatasetChanges (postgres)", () => {
  let pool: Pool;
  let repo: PostgresIdentityRepository;
  let userId: string;
  let datasetId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    repo = new PostgresIdentityRepository(pool);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`it-${Date.now()}@example.com`])).rows[0]!.id;
    const orgId = (await pool.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('it-org') RETURNING id`)).rows[0]!.id;
    const expId = (await pool.query<{ id: string }>(`INSERT INTO experiments (organization_id, name, service_name) VALUES ($1, 'e', $2) RETURNING id`, [orgId, `svc-${Date.now()}`])).rows[0]!.id;
    datasetId = (await repo.createDataset(expId, userId, "it-dataset")).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const latestItems = async () => repo.listDatasetItems((await repo.getLatestDatasetVersion(datasetId))!.id);

  it("applies adds, edits and removals as a single version", async () => {
    const v1 = await repo.commitDatasetChanges(datasetId, userId, {
      add: [1, 2, 3].map((n) => ({ input: `q${n}`, expectedOutput: `a${n}`, metadata: null })),
      update: [],
      remove: [],
    });
    expect([v1.major, v1.minor, v1.note]).toEqual([2, 0, "Added 3"]);
    const items = await latestItems();
    expect(items.map((i) => i.input)).toEqual(["q1", "q2", "q3"]);

    const v2 = await repo.commitDatasetChanges(datasetId, userId, {
      add: [{ input: "q4", expectedOutput: null, metadata: null }],
      update: [{ id: items[0]!.id, patch: { expectedOutput: "A1" } }],
      remove: [items[1]!.id],
    });
    expect([v2.major, v2.minor, v2.note]).toEqual([3, 0, "Added 1 · Edited 1 · Removed 1"]);
    const after = await latestItems();
    expect(after.map((i) => i.input)).toEqual(["q1", "q3", "q4"]);
    expect(after[0]!.expectedOutput).toBe("A1");
    expect(after[0]!.updatedByEmail).not.toBeNull();
    expect(after[1]!.updatedByEmail).toBeNull();
    const withDeleted = await repo.listDatasetVersionItemsWithDeleted(v2.id);
    expect(withDeleted.filter((i) => i.deletedAt).map((i) => i.input)).toEqual(["q2"]);
  });

  it("edits only → minor bump, and the previous version is untouched", async () => {
    const before = await repo.getLatestDatasetVersion(datasetId);
    const [first] = await latestItems();
    const v = await repo.commitDatasetChanges(datasetId, userId, { add: [], update: [{ id: first!.id, patch: { input: "Q1" } }], remove: [] });
    expect([v.major, v.minor]).toEqual([before!.major, before!.minor + 1]);
    expect((await repo.listDatasetItems(before!.id)).map((i) => i.input)).toContain("q1");
  });

  it("rejects stale ids and writes nothing", async () => {
    const before = await repo.listDatasetVersions(datasetId);
    await expect(repo.commitDatasetChanges(datasetId, userId, { add: [], update: [], remove: ["00000000-0000-0000-0000-000000000000"] })).rejects.toThrow(/changed since/);
    expect(await repo.listDatasetVersions(datasetId)).toHaveLength(before.length);
  });
});
