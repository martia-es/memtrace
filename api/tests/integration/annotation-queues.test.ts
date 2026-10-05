/**
 * Contra un Postgres real (15+) con las migraciones aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: `FOR UPDATE SKIP LOCKED` bajo concurrencia, caducidad del lease,
 * unicidad con `NULLS NOT DISTINCT` y el recálculo del estado en una sola sentencia (ADR-039).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAnnotationQueueRepository } from "@/adapters/outbound/postgres/postgres-annotation-queue-repository";
import { PostgresScoreConfigRepository } from "@/adapters/outbound/postgres/postgres-score-config-repository";
import type { AnnotationQueue } from "@/domain/annotation-queue";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("annotation queues (postgres)", () => {
  let pool: Pool;
  let repo: PostgresAnnotationQueueRepository;
  let experimentId: string;
  let configId: string;
  const users: string[] = [];
  const stamp = Date.now();

  const newUser = async (n: number) => (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`q${n}-${stamp}@example.com`])).rows[0]!.id;
  const newQueue = async (name: string, requiredAnnotations = 1): Promise<AnnotationQueue> =>
    repo.create(experimentId, users[0]!, { name, instructions: null, requiredAnnotations, reviewerIds: users, rubric: [{ configId, required: true }] });
  const traces = (n: number) => Array.from({ length: n }, (_, i) => ({ targetType: "trace" as const, traceId: `t${i}` }));

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    repo = new PostgresAnnotationQueueRepository(pool);
    for (let i = 0; i < 6; i++) users.push(await newUser(i));
    const orgId = (await pool.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('q-org') RETURNING id`)).rows[0]!.id;
    experimentId = (await pool.query<{ id: string }>(`INSERT INTO experiments (organization_id, name, service_name) VALUES ($1, 'e', $2) RETURNING id`, [orgId, `svc-${stamp}`])).rows[0]!.id;
    configId = (
      await new PostgresScoreConfigRepository(pool).create(experimentId, users[0]!, { name: "tone", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, description: null })
    ).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("ignores duplicate targets, including run items (NULLS NOT DISTINCT)", async () => {
    const queue = await newQueue("dups");
    const runId = "00000000-0000-4000-8000-000000000001";
    const targets = [...traces(2), { targetType: "run_item" as const, datasetRunId: runId, itemIndex: 0 }];
    expect(await repo.addItems(queue.id, users[0]!, targets)).toEqual({ added: 3, duplicates: 0 });
    expect(await repo.addItems(queue.id, users[0]!, [...targets, { targetType: "run_item", datasetRunId: runId, itemIndex: 1 }])).toEqual({ added: 1, duplicates: 3 });
  });

  it("stores how each item was chosen and keeps the original provenance of duplicates (ADR-040)", async () => {
    const queue = await newQueue("provenance");
    const runId = "00000000-0000-4000-8000-000000000002";
    const run = (itemIndex: number) => ({ targetType: "run_item" as const, datasetRunId: runId, itemIndex });
    await repo.addItems(queue.id, users[0]!, [run(0)]);
    await repo.addItems(queue.id, users[0]!, [run(0), run(1)], { population: "random_sample", seed: "seed-7" });
    const byIndex = new Map((await repo.listItems(queue.id, undefined, 10)).map((i) => [i.itemIndex, i]));
    expect(byIndex.get(0)).toMatchObject({ population: "manual", sampleSeed: null });
    expect(byIndex.get(1)).toMatchObject({ population: "random_sample", sampleSeed: "seed-7" });
  });

  it("never hands the same item to two simultaneous callers", async () => {
    const queue = await newQueue("race");
    await repo.addItems(queue.id, users[0]!, traces(3));
    const claimed = await Promise.all(users.map((u) => repo.claimNext(queue, u)));
    const ids = claimed.filter((i) => i !== null).map((i) => i!.id);
    expect(ids).toHaveLength(3); // 6 revisores, 3 items, 1 anotación requerida: 3 se quedan sin nada
    expect(new Set(ids).size).toBe(3);
  });

  it("hands one item to as many reviewers as annotations are required", async () => {
    const queue = await newQueue("multi", 2);
    await repo.addItems(queue.id, users[0]!, traces(1));
    const claimed = await Promise.all(users.map((u) => repo.claimNext(queue, u)));
    expect(claimed.filter((i) => i !== null)).toHaveLength(2);
  });

  it("resumes the reviewer's open item instead of burning another one", async () => {
    const queue = await newQueue("resume");
    await repo.addItems(queue.id, users[0]!, traces(2));
    const first = await repo.claimNext(queue, users[0]!);
    expect((await repo.claimNext(queue, users[0]!))?.id).toBe(first?.id);
  });

  it("frees an abandoned claim after the lease, without any background job", async () => {
    const queue = await newQueue("lease");
    await repo.addItems(queue.id, users[0]!, traces(1));
    const item = (await repo.claimNext(queue, users[0]!))!;
    expect(await repo.claimNext(queue, users[1]!)).toBeNull();
    await pool.query(`UPDATE annotation_queue_claims SET claimed_at = now() - interval '16 minutes' WHERE queue_item_id = $1`, [item.id]);
    expect((await repo.claimNext(queue, users[1]!))?.id).toBe(item.id);
  });

  it("completes an item only when enough reviewers finished, and recomputes when the requirement changes", async () => {
    const queue = await newQueue("derive", 2);
    await repo.addItems(queue.id, users[0]!, traces(2));
    const item = (await repo.claimNext(queue, users[0]!))!;
    expect((await repo.completeClaim(queue, item.id, users[0]!)).status).toBe("pending");
    expect(await repo.completeClaim(queue, item.id, users[0]!)).toMatchObject({ status: "pending" }); // idempotente
    await repo.claimNext(queue, users[1]!);
    expect((await repo.completeClaim(queue, item.id, users[1]!)).status).toBe("completed");
    expect(await repo.progress(queue.id)).toEqual({ pending: 1, completed: 1, skipped: 0 });

    await repo.update(experimentId, queue.id, { requiredAnnotations: 3 });
    expect(await repo.progress(queue.id)).toEqual({ pending: 2, completed: 0, skipped: 0 });
    await repo.update(experimentId, queue.id, { requiredAnnotations: 1 });
    expect(await repo.progress(queue.id)).toEqual({ pending: 1, completed: 1, skipped: 0 });
  });

  it("a skipped claim returns the item to others and to the same person only after unseen items; admin skip is not recomputed", async () => {
    const queue = await newQueue("skip");
    await repo.addItems(queue.id, users[0]!, traces(2));
    const item = (await repo.claimNext(queue, users[0]!))!;
    await repo.skipClaim(queue, item.id, users[0]!);
    expect((await repo.claimNext(queue, users[0]!))?.id).not.toBe(item.id);
    expect((await repo.claimNext(queue, users[1]!))?.id).toBe(item.id);
    // sin items nuevos, lo saltado se vuelve a ofrecer (un único revisor no pierde items)
    const [other] = await repo.listItems(queue.id, "pending", 10).then((all) => all.filter((i) => i.id !== item.id));
    await repo.skipClaim(queue, other!.id, users[0]!);
    expect((await repo.claimNext(queue, users[0]!))?.id).toBe(item.id);

    await repo.markUnreviewable(queue.id, item.id);
    await repo.update(experimentId, queue.id, { requiredAnnotations: 2 });
    expect((await repo.getItem(queue.id, item.id))?.status).toBe("skipped");
  });

  it("enforces name uniqueness among active queues only", async () => {
    const queue = await newQueue("unique");
    await expect(newQueue("unique")).rejects.toThrow(/already exists/);
    await repo.update(experimentId, queue.id, { archived: true });
    await expect(newQueue("unique")).resolves.toBeDefined();
  });

  it("only lets the rubric grow once the queue has items", async () => {
    const queue = await newQueue("rubric");
    const second = (await new PostgresScoreConfigRepository(pool).create(experimentId, users[0]!, { name: "note", dataType: "boolean", minValue: null, maxValue: null, categories: null, description: null })).id;
    await repo.addItems(queue.id, users[0]!, traces(1));
    const grown = await repo.update(experimentId, queue.id, { rubric: [{ configId, required: true }, { configId: second, required: false }] });
    expect(grown?.rubric.map((r) => r.configId)).toEqual([configId, second]);
    await expect(repo.update(experimentId, queue.id, { rubric: [{ configId: second, required: true }] })).rejects.toThrow(/cannot be removed/);
  });
  it("stores, replaces and clears a resolution scoped to its queue (ADR-050)", async () => {
    const queue = await newQueue("resolutions");
    const other = await newQueue("resolutions-other");
    await repo.addItems(queue.id, users[0]!, traces(1));
    const [item] = await repo.listItems(queue.id, undefined, 10);
    const draft = { queueItemId: item!.id, configId, value: "2", expectedOutput: "Hoy no llueve", resolvedBy: users[1]! };

    expect(await repo.upsertResolution(queue.id, draft)).toMatchObject({ value: "2", expectedOutput: "Hoy no llueve", resolvedBy: users[1] });
    await repo.upsertResolution(queue.id, { ...draft, value: "3", expectedOutput: null, resolvedBy: users[2]! });
    expect(await repo.listResolutions(queue.id, [item!.id])).toMatchObject([{ value: "3", expectedOutput: null, resolvedBy: users[2] }]);

    // otra cola no ve ni toca la resolución de este item
    expect(await repo.listResolutions(other.id, [item!.id])).toEqual([]);
    await expect(repo.upsertResolution(other.id, draft)).rejects.toThrow();
    expect(await repo.deleteResolution(other.id, item!.id, configId)).toBe(false);

    expect(await repo.deleteResolution(queue.id, item!.id, configId)).toBe(true);
    expect(await repo.deleteResolution(queue.id, item!.id, configId)).toBe(false);
  });
  it("lists the queues of the experiment that hold a trace, with the item status (ADR-050)", async () => {
    const a = await newQueue("membership-a");
    const b = await newQueue("membership-b");
    await repo.addItems(a.id, users[0]!, [{ targetType: "trace", traceId: "shared-trace" }]);
    await repo.addItems(b.id, users[0]!, [{ targetType: "trace", traceId: "shared-trace" }, { targetType: "trace", traceId: "only-b" }]);
    await repo.update(experimentId, b.id, { archived: true });

    const memberships = await repo.listQueuesForTrace(experimentId, "shared-trace");
    expect(memberships.map((m) => [m.queueName, m.archived, m.itemStatus])).toEqual([["membership-a", false, "pending"], ["membership-b", true, "pending"]]);
    expect(await repo.listQueuesForTrace(experimentId, "nobody")).toEqual([]);
    expect(await repo.listQueuesForTrace("00000000-0000-4000-8000-0000000000ff", "shared-trace")).toEqual([]);
  });
});
