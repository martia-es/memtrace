/**
 * Contra un Postgres real (15+) con las migraciones hasta la 054 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones, el trigger de inmutabilidad, la huella única y las cascadas (ADR-104).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresLessonRepository } from "@/adapters/outbound/postgres/postgres-lesson-repository";
import { LessonService } from "@/application/lesson-service";
import { LessonInvariantError } from "@/domain/errors";
import type { Permission } from "@/domain/permissions";

const url = process.env.POSTGRES_INTEGRATION_URL;
const TECH: Permission[] = ["lesson:read", "lesson:review", "lesson:approve"];
const body = { title: "No repitas search_flights", guidance: "Si search_flights falla, espera.", match: { tools: ["search_flights"] } };

describe.skipIf(!url)("lessons (postgres)", () => {
  let pool: Pool;
  let service: LessonService;
  let experimentA: string;
  let experimentB: string;
  let org: string;
  let actor: { userId: string; email: string };
  const stamp = Date.now();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const identity = new PostgresIdentityRepository(pool);
    const email = `lessons-${stamp}@example.com`;
    const userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [email])).rows[0]!.id;
    actor = { userId, email };
    org = (await identity.createOrganization(`lessons-${stamp}`, userId)).id;
    experimentA = (await identity.createExperiment(org, "a", `lessons-a-${stamp}`)).id;
    experimentB = (await identity.createExperiment(org, "b", `lessons-b-${stamp}`)).id;
    service = new LessonService(new PostgresLessonRepository(pool));
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [actor.email]);
    await pool.end();
  });

  it("seeds the permissions: business reviews but does not approve", async () => {
    const { rows } = await pool.query<{ role_name: string; permission: string }>(`SELECT role_name, permission FROM role_permissions WHERE permission LIKE 'lesson:%'`);
    const has = (role: string, permission: string) => rows.some((r) => r.role_name === role && r.permission === permission);
    expect(has("business", "lesson:review")).toBe(true);
    expect(has("business", "lesson:approve")).toBe(false);
    expect(has("technical", "lesson:approve")).toBe(true);
    expect(has("governance", "lesson:read")).toBe(true);
  });

  it("proposes a lesson from a finding once per experiment, and the same finding is fine in another one", async () => {
    const first = await service.propose(experimentA, actor, { ...body, findingId: "f1", evidenceTraceIds: ["ab".repeat(16)], originMetrics: { support: 35, failures: 32 } });
    expect(first.lesson.status).toBe("proposed");
    await expect(service.propose(experimentA, actor, { ...body, findingId: "f1" })).rejects.toBeInstanceOf(LessonInvariantError);
    await expect(service.propose(experimentB, actor, { ...body, findingId: "f1" })).resolves.toBeDefined();
    const detail = await service.get(experimentA, first.lesson.id);
    expect(detail.evidence.map((e) => e.traceId)).toEqual(["ab".repeat(16)]);
    expect(detail.events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("does not show a lesson to another experiment", async () => {
    const { lesson } = await service.propose(experimentA, actor, body);
    await expect(service.get(experimentB, lesson.id)).rejects.toThrow(/not found/);
  });

  it("a version is immutable: the trigger refuses to change its text", async () => {
    const { lesson } = await service.propose(experimentA, actor, body);
    await expect(pool.query(`UPDATE lesson_versions SET guidance = 'otro' WHERE lesson_id = $1`, [lesson.id])).rejects.toThrow(/immutable/);
  });

  it("serves only an approved lesson, and editing or retiring it stops serving it", async () => {
    const { lesson } = await service.propose(experimentA, actor, body);
    await expect(service.activate(experimentA, lesson.id, "pro", actor)).rejects.toBeInstanceOf(LessonInvariantError);
    await service.transition(experimentA, lesson.id, actor, TECH, { to: "reviewed" });
    await service.transition(experimentA, lesson.id, actor, TECH, { to: "approved" });
    await service.activate(experimentA, lesson.id, "pro", actor);
    expect((await service.get(experimentA, lesson.id)).summary.environments).toEqual(["pro"]);

    const edited = await service.edit(experimentA, lesson.id, actor, { ...body, guidance: "Otro texto." });
    expect(edited.lesson.status).toBe("proposed");
    expect(edited.lesson.currentVersion).toBe(2);
    expect(edited.environments).toEqual([]);
    const detail = await service.get(experimentA, lesson.id);
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.events.map((e) => e.kind)).toEqual(["version", "activate", "transition", "transition", "created"]);

    await service.transition(experimentA, lesson.id, actor, TECH, { to: "reviewed" });
    await service.transition(experimentA, lesson.id, actor, TECH, { to: "approved" });
    await service.activate(experimentA, lesson.id, "dev", actor);
    await service.transition(experimentA, lesson.id, actor, TECH, { to: "retired" });
    expect((await service.get(experimentA, lesson.id)).activations).toEqual([]);
  });

  it("deleting the experiment removes its lessons", async () => {
    const identity = new PostgresIdentityRepository(pool);
    const temp = (await identity.createExperiment(org, "temp", `lessons-temp-${stamp}`)).id;
    const { lesson } = await service.propose(temp, actor, body);
    await pool.query(`DELETE FROM experiments WHERE id = $1`, [temp]);
    const { rows } = await pool.query(`SELECT 1 FROM lessons WHERE id = $1`, [lesson.id]);
    expect(rows).toHaveLength(0);
  });
});
