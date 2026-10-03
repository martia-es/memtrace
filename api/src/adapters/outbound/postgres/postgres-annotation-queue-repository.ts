import type { Pool, PoolClient } from "pg";
import type { AddedItems, AnnotationQueueRepository, QueueWithProgress } from "@/application/ports/annotation-queue-repository";
import {
  CLAIM_LEASE_MINUTES,
  assertRubricOnlyGrows,
  type AnnotationQueue,
  type AnnotationQueuePatch,
  type NewAnnotationQueue,
  type QueueItem,
  type QueueItemStatus,
  type QueueProgress,
  type QueueRubricEntry,
  type QueuePopulation,
  type QueueProvenance,
  type QueueTarget,
  type ReviewerProgress,
} from "@/domain/annotation-queue";
import { AnnotationQueueInvariantError } from "@/domain/errors";

const QUEUE_COLUMNS = `id, experiment_id, name, instructions, required_annotations, created_by, created_at, archived_at`;
const ITEM_COLUMNS = `id, queue_id, target_type, trace_id, dataset_run_id, item_index, status, population, sample_seed, added_by, added_at, completed_at`;
const CLAIM_RETRIES = 4;
const CLAIM_RETRY_DELAY_MS = 40;
const UNIQUE_VIOLATION = "23505";
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe" (404)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QueueRow {
  id: string;
  experiment_id: string;
  name: string;
  instructions: string | null;
  required_annotations: number;
  created_by: string;
  created_at: Date | string;
  archived_at: Date | string | null;
}

interface RubricRow {
  queue_id: string;
  config_id: string;
  required: boolean;
  position: number;
}

interface ItemRow {
  id: string;
  queue_id: string;
  target_type: "trace" | "run_item";
  trace_id: string;
  dataset_run_id: string | null;
  item_index: number | null;
  status: QueueItemStatus;
  population: QueuePopulation;
  sample_seed: string | null;
  added_by: string;
  added_at: Date | string;
  completed_at: Date | string | null;
}

/**
 * Recalcula `status` desde los claims: completed = claims completados >= required_annotations de la cola.
 * Un item `skipped` (acción de admin) no se toca. `$1` filtra por item o por cola según `scope`.
 */
function recomputeStatusSql(scope: "item" | "queue"): string {
  const filter = scope === "item" ? "i2.id = $1" : "i2.queue_id = $1";
  return `UPDATE annotation_queue_items i
             SET status = s.status,
                 completed_at = CASE WHEN s.status = 'completed' THEN COALESCE(i.completed_at, now()) ELSE NULL END
            FROM (SELECT i2.id,
                         CASE WHEN count(c.completed_at) >= q.required_annotations THEN 'completed' ELSE 'pending' END AS status
                    FROM annotation_queue_items i2
                    JOIN annotation_queues q ON q.id = i2.queue_id
                    LEFT JOIN annotation_queue_claims c ON c.queue_item_id = i2.id
                   WHERE ${filter} AND i2.status <> 'skipped'
                   GROUP BY i2.id, q.required_annotations) s
           WHERE i.id = s.id`;
}

export class PostgresAnnotationQueueRepository implements AnnotationQueueRepository {
  constructor(private readonly pool: Pool) {}

  async list(experimentId: string, includeArchived: boolean): Promise<QueueWithProgress[]> {
    const { rows } = await this.pool.query<QueueRow>(
      `SELECT ${QUEUE_COLUMNS} FROM annotation_queues
        WHERE experiment_id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}
        ORDER BY created_at DESC`,
      [experimentId],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [rubrics, counts] = await Promise.all([
      this.pool.query<RubricRow>(`SELECT queue_id, config_id, required, position FROM annotation_queue_configs WHERE queue_id = ANY($1) ORDER BY position`, [ids]),
      this.pool.query<{ queue_id: string; status: QueueItemStatus; n: number }>(
        `SELECT queue_id, status, count(*)::int AS n FROM annotation_queue_items WHERE queue_id = ANY($1) GROUP BY queue_id, status`,
        [ids],
      ),
    ]);
    return rows.map((row) => {
      const progress: QueueProgress = { pending: 0, completed: 0, skipped: 0 };
      for (const c of counts.rows) if (c.queue_id === row.id) progress[c.status] = c.n;
      return { queue: toQueue(row, rubrics.rows.filter((r) => r.queue_id === row.id)), progress };
    });
  }

  async get(experimentId: string, queueId: string): Promise<AnnotationQueue | null> {
    if (!UUID.test(queueId)) return null;
    return this.fetchQueue(this.pool, experimentId, queueId);
  }

  async progress(queueId: string): Promise<QueueProgress> {
    const { rows } = await this.pool.query<{ status: QueueItemStatus; n: number }>(
      `SELECT status, count(*)::int AS n FROM annotation_queue_items WHERE queue_id = $1 GROUP BY status`,
      [queueId],
    );
    const progress: QueueProgress = { pending: 0, completed: 0, skipped: 0 };
    for (const r of rows) progress[r.status] = r.n;
    return progress;
  }

  async reviewers(queueId: string): Promise<ReviewerProgress[]> {
    const { rows } = await this.pool.query<{ user_id: string; completed: number; skipped: number; in_progress: number }>(
      `SELECT c.user_id,
              count(*) FILTER (WHERE c.completed_at IS NOT NULL)::int AS completed,
              count(*) FILTER (WHERE c.skipped_at IS NOT NULL AND c.completed_at IS NULL)::int AS skipped,
              count(*) FILTER (WHERE c.completed_at IS NULL AND c.skipped_at IS NULL)::int AS in_progress
         FROM annotation_queue_claims c
         JOIN annotation_queue_items i ON i.id = c.queue_item_id
        WHERE i.queue_id = $1
        GROUP BY c.user_id
        ORDER BY completed DESC, c.user_id`,
      [queueId],
    );
    return rows.map((r) => ({ userId: r.user_id, completed: r.completed, skipped: r.skipped, inProgress: r.in_progress }));
  }

  async create(experimentId: string, createdByUserId: string, input: NewAnnotationQueue): Promise<AnnotationQueue> {
    return this.transaction(async (client) => {
      let row: QueueRow;
      try {
        const { rows } = await client.query<QueueRow>(
          `INSERT INTO annotation_queues (experiment_id, name, instructions, required_annotations, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${QUEUE_COLUMNS}`,
          [experimentId, input.name, input.instructions, input.requiredAnnotations, createdByUserId],
        );
        row = rows[0]!;
      } catch (error) {
        throw mapNameTaken(error, input.name);
      }
      await this.writeRubric(client, row.id, input.rubric);
      return (await this.fetchQueue(client, experimentId, row.id))!;
    });
  }

  async update(experimentId: string, queueId: string, patch: AnnotationQueuePatch): Promise<AnnotationQueue | null> {
    if (!UUID.test(queueId)) return null;
    return this.transaction(async (client) => {
      const current = await this.fetchQueue(client, experimentId, queueId, true);
      if (!current) return null;

      if (patch.rubric) {
        const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM annotation_queue_items WHERE queue_id = $1`, [queueId]);
        const started = rows[0]!.n > 0;
        if (started) assertRubricOnlyGrows(current.rubric, patch.rubric);
        else await client.query(`DELETE FROM annotation_queue_configs WHERE queue_id = $1`, [queueId]);
        await this.writeRubric(client, queueId, patch.rubric);
      }
      try {
        await client.query(
          `UPDATE annotation_queues
              SET name = $2, instructions = $3, required_annotations = $4,
                  archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN COALESCE(archived_at, now()) ELSE NULL END
            WHERE id = $1`,
          [
            queueId,
            patch.name ?? current.name,
            patch.instructions === undefined ? current.instructions : patch.instructions,
            patch.requiredAnnotations ?? current.requiredAnnotations,
            patch.archived ?? null,
          ],
        );
      } catch (error) {
        throw mapNameTaken(error, patch.name ?? current.name);
      }
      if (patch.requiredAnnotations !== undefined && patch.requiredAnnotations !== current.requiredAnnotations) {
        await client.query(recomputeStatusSql("queue"), [queueId]);
      }
      return (await this.fetchQueue(client, experimentId, queueId))!;
    });
  }

  async addItems(queueId: string, addedBy: string, targets: QueueTarget[], provenance: QueueProvenance = { population: "manual", seed: null }): Promise<AddedItems> {
    if (targets.length === 0) return { added: 0, duplicates: 0 };
    const types = targets.map((t) => t.targetType);
    const traceIds = targets.map((t) => (t.targetType === "trace" ? t.traceId : ""));
    const runIds = targets.map((t) => (t.targetType === "run_item" ? t.datasetRunId : null));
    const indexes = targets.map((t) => (t.targetType === "run_item" ? t.itemIndex : null));
    // `unnest` inserta el lote entero en una sola sentencia; ON CONFLICT descarta los ya presentes (NULLS NOT DISTINCT)
    const { rowCount } = await this.pool.query(
      `INSERT INTO annotation_queue_items (queue_id, target_type, trace_id, dataset_run_id, item_index, added_by, population, sample_seed)
       SELECT $1::uuid, t.target_type, t.trace_id, t.dataset_run_id, t.item_index, $6::uuid, $7::text, $8::text
         FROM unnest($2::text[], $3::text[], $4::uuid[], $5::int[]) AS t(target_type, trace_id, dataset_run_id, item_index)
       ON CONFLICT DO NOTHING`,
      [queueId, types, traceIds, runIds, indexes, addedBy, provenance.population, provenance.seed],
    );
    const added = rowCount ?? 0;
    return { added, duplicates: targets.length - added };
  }

  async listItems(queueId: string, status: QueueItemStatus | undefined, limit: number): Promise<QueueItem[]> {
    const { rows } = await this.pool.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM annotation_queue_items
        WHERE queue_id = $1 ${status ? "AND status = $3" : ""}
        ORDER BY added_at ASC, id ASC LIMIT $2`,
      status ? [queueId, limit, status] : [queueId, limit],
    );
    return rows.map(toItem);
  }

  async getItem(queueId: string, itemId: string): Promise<QueueItem | null> {
    if (!UUID.test(itemId)) return null;
    return this.fetchItem(this.pool, queueId, itemId);
  }

  async claimNext(queue: AnnotationQueue, userId: string): Promise<QueueItem | null> {
    // `SKIP LOCKED` nunca reparte de más, pero si otra llamada tiene bloqueado el único item libre, esta ve "nada"
    // aunque aún quepa un revisor más (required_annotations > 1). Se reintenta unos instantes mientras
    // quede un candidato sin bloquear que en realidad existe; cuando la otra transacción confirma, el recuento
    // se actualiza y el candidato desaparece (o se obtiene).
    for (let attempt = 0; ; attempt++) {
      const { item, contended } = await this.tryClaim(queue, userId);
      if (item || !contended || attempt >= CLAIM_RETRIES) return item;
      await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_DELAY_MS));
    }
  }

  private async tryClaim(queue: AnnotationQueue, userId: string): Promise<{ item: QueueItem | null; contended: boolean }> {
    return this.transaction(async (client) => {
      // `FOR UPDATE SKIP LOCKED` bloquea la fila del item, pero el recuento de claims vive en otra tabla y no se
      // reevalúa si otra transacción confirma entre la lectura y el bloqueo: dos revisores podían llevarse el mismo
      // item cuando `required_annotations` ya estaba cubierto. El lock por cola serializa el reparto (transacciones
      // de milisegundos) y cada sentencia posterior ya ve los claims confirmados.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`annotation-queue-claim:${queue.id}`]);
      // reanudar: refrescar el claim no gasta otro item
      const resumed = await client.query<ItemRow>(
        `SELECT ${prefixed("i", ITEM_COLUMNS)} FROM annotation_queue_items i
           JOIN annotation_queue_claims c ON c.queue_item_id = i.id
          WHERE i.queue_id = $1 AND c.user_id = $2 AND i.status = 'pending'
            AND c.completed_at IS NULL AND c.skipped_at IS NULL
          ORDER BY c.claimed_at ASC LIMIT 1`,
        [queue.id, userId],
      );
      if (resumed.rows[0]) {
        await client.query(`UPDATE annotation_queue_claims SET claimed_at = now() WHERE queue_item_id = $1 AND user_id = $2`, [resumed.rows[0].id, userId]);
        return { item: toItem(resumed.rows[0]), contended: false };
      }

      const params = [queue.id, userId, queue.requiredAnnotations, CLAIM_LEASE_MINUTES];
      const { rows } = await client.query<ItemRow>(candidateSql(true), params);
      const item = rows[0];
      if (!item) {
        const probe = await client.query(candidateSql(false), params);
        return { item: null, contended: (probe.rowCount ?? 0) > 0 };
      }
      await client.query(`INSERT INTO annotation_queue_claims (queue_item_id, user_id) VALUES ($1, $2)`, [item.id, userId]);
      return { item: toItem(item), contended: false };
    });
  }

  async hasClaim(itemId: string, userId: string): Promise<boolean> {
    if (!UUID.test(itemId)) return false;
    const { rowCount } = await this.pool.query(`SELECT 1 FROM annotation_queue_claims WHERE queue_item_id = $1 AND user_id = $2`, [itemId, userId]);
    return (rowCount ?? 0) > 0;
  }

  async completeClaim(queue: AnnotationQueue, itemId: string, userId: string): Promise<QueueItem> {
    return this.transaction(async (client) => {
      await client.query(
        `INSERT INTO annotation_queue_claims (queue_item_id, user_id, completed_at) VALUES ($1, $2, now())
         ON CONFLICT (queue_item_id, user_id) DO UPDATE SET completed_at = COALESCE(annotation_queue_claims.completed_at, now()), skipped_at = NULL`,
        [itemId, userId],
      );
      await client.query(recomputeStatusSql("item"), [itemId]);
      return (await this.fetchItem(client, queue.id, itemId))!;
    });
  }

  async skipClaim(queue: AnnotationQueue, itemId: string, userId: string): Promise<QueueItem> {
    return this.transaction(async (client) => {
      // una revisión ya completada no se puede saltar después
      await client.query(
        `INSERT INTO annotation_queue_claims (queue_item_id, user_id, skipped_at) VALUES ($1, $2, now())
         ON CONFLICT (queue_item_id, user_id) DO UPDATE SET skipped_at = now() WHERE annotation_queue_claims.completed_at IS NULL`,
        [itemId, userId],
      );
      return (await this.fetchItem(client, queue.id, itemId))!;
    });
  }

  async markUnreviewable(queueId: string, itemId: string): Promise<QueueItem | null> {
    if (!UUID.test(itemId)) return null;
    const { rows } = await this.pool.query<ItemRow>(
      `UPDATE annotation_queue_items SET status = 'skipped', completed_at = NULL WHERE id = $1 AND queue_id = $2 RETURNING ${ITEM_COLUMNS}`,
      [itemId, queueId],
    );
    return rows[0] ? toItem(rows[0]) : null;
  }

  private async fetchQueue(db: Pool | PoolClient, experimentId: string, queueId: string, lock = false): Promise<AnnotationQueue | null> {
    const { rows } = await db.query<QueueRow>(
      `SELECT ${QUEUE_COLUMNS} FROM annotation_queues WHERE id = $1 AND experiment_id = $2 ${lock ? "FOR UPDATE" : ""}`,
      [queueId, experimentId],
    );
    if (!rows[0]) return null;
    const rubric = await db.query<RubricRow>(`SELECT queue_id, config_id, required, position FROM annotation_queue_configs WHERE queue_id = $1 ORDER BY position`, [queueId]);
    return toQueue(rows[0], rubric.rows);
  }

  private async fetchItem(db: Pool | PoolClient, queueId: string, itemId: string): Promise<QueueItem | null> {
    const { rows } = await db.query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM annotation_queue_items WHERE id = $1 AND queue_id = $2`, [itemId, queueId]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  private async writeRubric(client: PoolClient, queueId: string, rubric: Array<{ configId: string; required: boolean }>): Promise<void> {
    for (const [position, entry] of rubric.entries()) {
      await client.query(
        `INSERT INTO annotation_queue_configs (queue_id, config_id, required, position) VALUES ($1, $2, $3, $4)
         ON CONFLICT (queue_id, config_id) DO UPDATE SET required = EXCLUDED.required, position = EXCLUDED.position`,
        [queueId, entry.configId, entry.required, position],
      );
    }
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Primer item pendiente que este revisor puede coger: no lo ha tocado y aún caben revisores (claims vivos < requeridos). */
function candidateSql(lock: boolean): string {
  return `SELECT ${prefixed("i", ITEM_COLUMNS)} FROM annotation_queue_items i
           WHERE i.queue_id = $1 AND i.status = 'pending'
             AND NOT EXISTS (SELECT 1 FROM annotation_queue_claims c WHERE c.queue_item_id = i.id AND c.user_id = $2)
             AND (SELECT count(*) FROM annotation_queue_claims c
                   WHERE c.queue_item_id = i.id AND c.skipped_at IS NULL
                     AND (c.completed_at IS NOT NULL OR c.claimed_at > now() - make_interval(mins => $4))) < $3
           ORDER BY i.added_at ASC, i.id ASC
           ${lock ? "FOR UPDATE OF i SKIP LOCKED" : ""}
           LIMIT 1`;
}

function prefixed(alias: string, columns: string): string {
  return columns
    .split(",")
    .map((c) => `${alias}.${c.trim()}`)
    .join(", ");
}

function mapNameTaken(error: unknown, name: string): unknown {
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
    return new AnnotationQueueInvariantError(`An active annotation queue named "${name}" already exists in this experiment`);
  }
  return error;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toQueue(row: QueueRow, rubric: RubricRow[]): AnnotationQueue {
  const entries: QueueRubricEntry[] = rubric.map((r) => ({ configId: r.config_id, required: r.required, position: r.position }));
  return {
    id: row.id,
    experimentId: row.experiment_id,
    name: row.name,
    instructions: row.instructions,
    requiredAnnotations: row.required_annotations,
    rubric: entries,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
  };
}

function toItem(row: ItemRow): QueueItem {
  return {
    id: row.id,
    queueId: row.queue_id,
    targetType: row.target_type,
    traceId: row.trace_id === "" ? null : row.trace_id,
    datasetRunId: row.dataset_run_id,
    itemIndex: row.item_index,
    status: row.status,
    population: row.population,
    sampleSeed: row.sample_seed,
    addedBy: row.added_by,
    addedAt: iso(row.added_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  };
}
