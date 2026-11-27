import type { Pool, PoolClient } from "pg";
import type { LessonDetail, LessonRepository, NewEvidence } from "@/application/ports/lesson-repository";
import { LessonInvariantError } from "@/domain/errors";
import type {
  Lesson,
  LessonActivation,
  LessonContent,
  LessonEvent,
  LessonEventKind,
  LessonEvidence,
  LessonMatch,
  LessonStatus,
  LessonSummary,
  LessonVersion,
  NewLesson,
  NewLessonVersion,
} from "@/domain/lesson";
import { EDITABLE_STATUSES } from "@/domain/lesson";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
type Actor = { id: string | null; label: string };

interface LessonRow {
  id: string;
  experiment_id: string;
  status: LessonStatus;
  source: Lesson["source"];
  fingerprint: string | null;
  current_version: number;
  origin_metrics: Record<string, unknown>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
interface VersionRow {
  id: string;
  lesson_id: string;
  version: number;
  title: string;
  situation: string;
  failure: string;
  guidance: string;
  match: LessonMatch;
  content_hash: string;
  origin: LessonVersion["origin"];
  message: string;
  created_by: string | null;
  created_at: Ts;
}
interface EventRow {
  id: string;
  lesson_id: string;
  kind: LessonEventKind;
  from_status: LessonStatus | null;
  to_status: LessonStatus | null;
  version: number | null;
  environment: string | null;
  actor_id: string | null;
  actor_label: string;
  comment: string;
  at: Ts;
}

const LESSON_COLUMNS = "id, experiment_id, status, source, fingerprint, current_version, origin_metrics, created_by, created_at, updated_at";
const VERSION_COLUMNS = "id, lesson_id, version, title, situation, failure, guidance, match, content_hash, origin, message, created_by, created_at";

const toLesson = (r: LessonRow): Lesson => ({
  id: r.id,
  experimentId: r.experiment_id,
  status: r.status,
  source: r.source,
  fingerprint: r.fingerprint,
  currentVersion: r.current_version,
  originMetrics: r.origin_metrics,
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const toVersion = (r: VersionRow): LessonVersion => ({
  id: r.id,
  lessonId: r.lesson_id,
  version: r.version,
  title: r.title,
  situation: r.situation,
  failure: r.failure,
  guidance: r.guidance,
  match: r.match,
  contentHash: r.content_hash,
  origin: r.origin,
  message: r.message,
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
});
const toEvent = (r: EventRow): LessonEvent => ({
  id: r.id,
  lessonId: r.lesson_id,
  kind: r.kind,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  version: r.version,
  environment: r.environment,
  actorId: r.actor_id,
  actorLabel: r.actor_label,
  comment: r.comment,
  at: iso(r.at),
});

export class PostgresLessonRepository implements LessonRepository {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(experimentId: string, status?: LessonStatus): Promise<LessonSummary[]> {
    if (!UUID.test(experimentId)) return [];
    const { rows } = await this.pool.query<LessonRow & { v: VersionRow; envs: string[] | null }>(
      `SELECT l.id, l.experiment_id, l.status, l.source, l.fingerprint, l.current_version, l.origin_metrics, l.created_by, l.created_at, l.updated_at,
              to_jsonb(v.*) AS v,
              (SELECT array_agg(a.environment ORDER BY a.environment) FROM lesson_activations a WHERE a.lesson_id = l.id) AS envs
         FROM lessons l JOIN lesson_versions v ON v.lesson_id = l.id AND v.version = l.current_version
        WHERE l.experiment_id = $1 AND ($2::text IS NULL OR l.status = $2)
        ORDER BY l.updated_at DESC`,
      [experimentId, status ?? null],
    );
    return rows.map((r) => ({ lesson: toLesson(r), current: toVersion(r.v), environments: r.envs ?? [] }));
  }

  async get(experimentId: string, lessonId: string): Promise<LessonDetail | null> {
    if (!UUID.test(experimentId) || !UUID.test(lessonId)) return null;
    const lesson = await this.pool.query<LessonRow>(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = $1 AND experiment_id = $2`, [lessonId, experimentId]);
    if (lesson.rows.length === 0) return null;
    const [versions, evidence, activations, events] = await Promise.all([
      this.pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM lesson_versions WHERE lesson_id = $1 ORDER BY version DESC`, [lessonId]),
      this.pool.query<{ trace_id: string; kind: LessonEvidence["kind"]; added_at: Ts }>("SELECT trace_id, kind, added_at FROM lesson_evidence WHERE lesson_id = $1 ORDER BY added_at", [lessonId]),
      this.pool.query<{ lesson_id: string; environment: string; version: number; activated_by: string | null; activated_at: Ts }>(
        "SELECT lesson_id, environment, version, activated_by, activated_at FROM lesson_activations WHERE lesson_id = $1 ORDER BY environment",
        [lessonId],
      ),
      this.pool.query<EventRow>("SELECT id, lesson_id, kind, from_status, to_status, version, environment, actor_id, actor_label, comment, at FROM lesson_events WHERE lesson_id = $1 ORDER BY at DESC", [lessonId]),
    ]);
    const versionList = versions.rows.map(toVersion);
    const current = versionList.find((v) => v.version === lesson.rows[0]!.current_version)!;
    const activationList: LessonActivation[] = activations.rows.map((a) => ({ lessonId: a.lesson_id, environment: a.environment, version: a.version, activatedBy: a.activated_by, activatedAt: iso(a.activated_at) }));
    return {
      summary: { lesson: toLesson(lesson.rows[0]!), current, environments: activationList.map((a) => a.environment) },
      versions: versionList,
      evidence: evidence.rows.map((e) => ({ traceId: e.trace_id, kind: e.kind, addedAt: iso(e.added_at) })),
      activations: activationList,
      events: events.rows.map(toEvent),
    };
  }

  async create(lesson: NewLesson, version: LessonContent & { contentHash: string; message: string }, evidence: NewEvidence[]): Promise<LessonSummary> {
    try {
      return await this.tx(async (c) => {
        const created = await c.query<LessonRow>(
          `INSERT INTO lessons (experiment_id, source, fingerprint, origin_metrics, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING ${LESSON_COLUMNS}`,
          [lesson.experimentId, lesson.source, lesson.fingerprint, JSON.stringify(lesson.originMetrics), lesson.createdBy],
        );
        const row = created.rows[0]!;
        const origin = lesson.source === "mem" ? "mem" : "human";
        const v = await c.query<VersionRow>(
          `INSERT INTO lesson_versions (lesson_id, version, title, situation, failure, guidance, match, content_hash, origin, message, created_by)
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${VERSION_COLUMNS}`,
          [row.id, version.title, version.situation, version.failure, version.guidance, JSON.stringify(version.match), version.contentHash, origin, version.message, lesson.createdBy],
        );
        for (const e of evidence) {
          await c.query("INSERT INTO lesson_evidence (lesson_id, trace_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [row.id, e.traceId, e.kind]);
        }
        await c.query(`INSERT INTO lesson_events (lesson_id, kind, to_status, version, actor_id, actor_label) VALUES ($1, 'created', 'proposed', 1, $2, $3)`, [row.id, lesson.createdBy, lesson.actorLabel]);
        return { lesson: toLesson(row), current: toVersion(v.rows[0]!), environments: [] };
      });
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new LessonInvariantError("A lesson for this finding already exists");
      throw error;
    }
  }

  async addVersion(experimentId: string, lessonId: string, version: NewLessonVersion): Promise<LessonSummary | null> {
    if (!UUID.test(experimentId) || !UUID.test(lessonId)) return null;
    return this.tx(async (c) => {
      const found = await c.query<LessonRow>(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = $1 AND experiment_id = $2 FOR UPDATE`, [lessonId, experimentId]);
      const lesson = found.rows[0];
      if (!lesson) return null;
      if (!EDITABLE_STATUSES.includes(lesson.status)) throw new LessonInvariantError(`A ${lesson.status} lesson cannot be edited`);
      const next = lesson.current_version + 1;
      const v = await c.query<VersionRow>(
        `INSERT INTO lesson_versions (lesson_id, version, title, situation, failure, guidance, match, content_hash, origin, message, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${VERSION_COLUMNS}`,
        [lessonId, next, version.title, version.situation, version.failure, version.guidance, JSON.stringify(version.match), version.contentHash, version.origin, version.message, version.createdBy],
      );
      // un texto nuevo vuelve a pasar por revisión y nunca hereda las activaciones del anterior
      await c.query("DELETE FROM lesson_activations WHERE lesson_id = $1", [lessonId]);
      const updated = await c.query<LessonRow>(`UPDATE lessons SET current_version = $2, status = 'proposed', updated_at = now() WHERE id = $1 RETURNING ${LESSON_COLUMNS}`, [lessonId, next]);
      await c.query(`INSERT INTO lesson_events (lesson_id, kind, from_status, to_status, version, actor_id, actor_label, comment) VALUES ($1, 'version', $2, 'proposed', $3, $4, $5, $6)`, [
        lessonId,
        lesson.status,
        next,
        version.createdBy,
        version.actorLabel,
        version.message,
      ]);
      return { lesson: toLesson(updated.rows[0]!), current: toVersion(v.rows[0]!), environments: [] };
    });
  }

  async transition(experimentId: string, lessonId: string, from: LessonStatus, to: LessonStatus, actor: Actor, comment: string): Promise<Lesson | null> {
    if (!UUID.test(experimentId) || !UUID.test(lessonId)) return null;
    return this.tx(async (c) => {
      const found = await c.query<LessonRow>(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = $1 AND experiment_id = $2 FOR UPDATE`, [lessonId, experimentId]);
      const lesson = found.rows[0];
      if (!lesson) return null;
      if (lesson.status !== from) throw new LessonInvariantError(`The lesson is now ${lesson.status}, not ${from}; reload and try again`);
      if (from === "approved") await c.query("DELETE FROM lesson_activations WHERE lesson_id = $1", [lessonId]);
      const updated = await c.query<LessonRow>(`UPDATE lessons SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${LESSON_COLUMNS}`, [lessonId, to]);
      await c.query(`INSERT INTO lesson_events (lesson_id, kind, from_status, to_status, version, actor_id, actor_label, comment) VALUES ($1, 'transition', $2, $3, $4, $5, $6, $7)`, [
        lessonId,
        from,
        to,
        lesson.current_version,
        actor.id,
        actor.label,
        comment,
      ]);
      return toLesson(updated.rows[0]!);
    });
  }

  async activate(experimentId: string, lessonId: string, environment: string, actor: Actor): Promise<LessonActivation | null> {
    if (!UUID.test(experimentId) || !UUID.test(lessonId)) return null;
    return this.tx(async (c) => {
      const found = await c.query<LessonRow>(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = $1 AND experiment_id = $2 FOR UPDATE`, [lessonId, experimentId]);
      const lesson = found.rows[0];
      if (!lesson) return null;
      if (lesson.status !== "approved") throw new LessonInvariantError("Only an approved lesson can be turned on in an environment");
      const { rows } = await c.query<{ lesson_id: string; environment: string; version: number; activated_by: string | null; activated_at: Ts }>(
        `INSERT INTO lesson_activations (lesson_id, environment, version, activated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (lesson_id, environment) DO UPDATE SET version = EXCLUDED.version, activated_by = EXCLUDED.activated_by, activated_at = now()
         RETURNING lesson_id, environment, version, activated_by, activated_at`,
        [lessonId, environment, lesson.current_version, actor.id],
      );
      await c.query(`INSERT INTO lesson_events (lesson_id, kind, version, environment, actor_id, actor_label) VALUES ($1, 'activate', $2, $3, $4, $5)`, [lessonId, lesson.current_version, environment, actor.id, actor.label]);
      const a = rows[0]!;
      return { lessonId: a.lesson_id, environment: a.environment, version: a.version, activatedBy: a.activated_by, activatedAt: iso(a.activated_at) };
    });
  }

  async deactivate(experimentId: string, lessonId: string, environment: string, actor: Actor): Promise<boolean> {
    if (!UUID.test(experimentId) || !UUID.test(lessonId)) return false;
    return this.tx(async (c) => {
      const owned = await c.query("SELECT 1 FROM lessons WHERE id = $1 AND experiment_id = $2 FOR UPDATE", [lessonId, experimentId]);
      if (owned.rows.length === 0) return false;
      const removed = await c.query("DELETE FROM lesson_activations WHERE lesson_id = $1 AND environment = $2", [lessonId, environment]);
      if ((removed.rowCount ?? 0) === 0) return false;
      await c.query(`INSERT INTO lesson_events (lesson_id, kind, environment, actor_id, actor_label) VALUES ($1, 'deactivate', $2, $3, $4)`, [lessonId, environment, actor.id, actor.label]);
      return true;
    });
  }
}
