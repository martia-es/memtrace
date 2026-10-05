/**
 * Contra un Postgres real con las migraciones aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Verifica ADR-038: una sola versión por lote, duplicados descartados y atomicidad bajo promociones concurrentes.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("addPromotedDatasetItems (postgres)", () => {
  let pool: Pool;
  let repo: PostgresIdentityRepository;
  let userId: string;
  let expId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    repo = new PostgresIdentityRepository(pool);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`promo-${Date.now()}@example.com`])).rows[0]!.id;
    const orgId = (await pool.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('promo-org') RETURNING id`)).rows[0]!.id;
    expId = (await pool.query<{ id: string }>(`INSERT INTO experiments (organization_id, name, service_name) VALUES ($1, 'e', $2) RETURNING id`, [orgId, `svc-${Date.now()}`])).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const draft = (traceId: string) => ({ traceId, input: `q-${traceId}`, expectedOutput: null, metadata: { promotedFrom: { traceId } } });
  const newDataset = async () => (await repo.createDataset(expId, userId, `ds-${Math.random()}`)).id;
  const liveItems = async (datasetId: string) => repo.listDatasetItems((await repo.getLatestDatasetVersion(datasetId))!.id);

  it("creates ONE major for the whole batch and skips traces already in the latest version", async () => {
    const datasetId = await newDataset();
    const first = await repo.addPromotedDatasetItems(datasetId, userId, [draft("a"), draft("b"), draft("c")]);
    expect([first.version?.major, first.version?.minor, first.version?.note]).toEqual([2, 0, "Added 3 items from traces"]);
    expect(first.added).toHaveLength(3);

    const second = await repo.addPromotedDatasetItems(datasetId, userId, [draft("b"), draft("d")]);
    expect(second.alreadyPromoted).toEqual(["b"]);
    expect(second.added.map((i) => i.input)).toEqual(["q-d"]);
    expect(second.version?.major).toBe(3);
    expect(await liveItems(datasetId)).toHaveLength(4);
  });

  it("does not create a version when everything is a duplicate", async () => {
    const datasetId = await newDataset();
    await repo.addPromotedDatasetItems(datasetId, userId, [draft("a")]);
    const again = await repo.addPromotedDatasetItems(datasetId, userId, [draft("a")]);
    expect(again).toMatchObject({ added: [], alreadyPromoted: ["a"], version: null });
    expect((await repo.getLatestDatasetVersion(datasetId))!.major).toBe(2);
  });

  it("allows re-promoting a trace after its item was deleted", async () => {
    const datasetId = await newDataset();
    const { added } = await repo.addPromotedDatasetItems(datasetId, userId, [draft("a")]);
    await repo.deleteDatasetItem(datasetId, added[0]!.id, userId);
    const again = await repo.addPromotedDatasetItems(datasetId, userId, [draft("a")]);
    expect(again.added).toHaveLength(1);
    expect(again.alreadyPromoted).toEqual([]);
  });

  it("promotes the same trace once under concurrent calls", async () => {
    const datasetId = await newDataset();
    const results = await Promise.all(Array.from({ length: 5 }, () => repo.addPromotedDatasetItems(datasetId, userId, [draft("race")])));
    expect(results.reduce((n, r) => n + r.added.length, 0)).toBe(1);
    expect((await liveItems(datasetId)).filter((i) => (i.metadata as { promotedFrom?: { traceId?: string } } | null)?.promotedFrom?.traceId === "race")).toHaveLength(1);
  });

  it("keeps promotedFrom when the rest of the metadata is edited or cleared", async () => {
    const datasetId = await newDataset();
    const { added } = await repo.addPromotedDatasetItems(datasetId, userId, [draft("a")]);
    await repo.updateDatasetItem(datasetId, added[0]!.id, userId, { metadata: { tag: "x" } });
    let [item] = await liveItems(datasetId);
    expect(item!.metadata).toEqual({ tag: "x", promotedFrom: { traceId: "a" } });

    await repo.updateDatasetItem(datasetId, item!.id, userId, { metadata: null });
    [item] = await liveItems(datasetId);
    expect(item!.metadata).toEqual({ promotedFrom: { traceId: "a" } });

    await repo.commitDatasetChanges(datasetId, userId, { add: [], update: [{ id: item!.id, patch: { metadata: { other: 1 } } }], remove: [] });
    [item] = await liveItems(datasetId);
    expect(item!.metadata).toEqual({ other: 1, promotedFrom: { traceId: "a" } });
  });
  it("finds the datasets whose LATEST version holds an item promoted from each trace (ADR-050)", async () => {
    const datasetId = await newDataset();
    await repo.addPromotedDatasetItems(datasetId, userId, [draft("found-a"), draft("found-b")]);
    const other = await newDataset();
    await repo.addPromotedDatasetItems(other, userId, [draft("found-a")]);

    const found = await repo.findPromotedTraces(expId, ["found-a", "found-b", "never"]);
    expect(found.filter((f) => f.traceId === "found-a").map((f) => f.datasetId).sort()).toEqual([datasetId, other].sort());
    expect(found.find((f) => f.traceId === "found-b")).toMatchObject({ datasetId, version: "2.0" });
    expect(found.some((f) => f.traceId === "never")).toBe(false);
    expect(await repo.findPromotedTraces(expId, [])).toEqual([]);
  });

  it("does not report a trace whose item was removed in the latest version", async () => {
    const datasetId = await newDataset();
    const { added } = await repo.addPromotedDatasetItems(datasetId, userId, [draft("gone")]);
    await repo.deleteDatasetItem(datasetId, added[0]!.id, userId);
    expect((await repo.findPromotedTraces(expId, ["gone"])).filter((f) => f.datasetId === datasetId)).toEqual([]);
  });
});
