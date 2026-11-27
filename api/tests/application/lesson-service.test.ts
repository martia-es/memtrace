import { describe, expect, it } from "vitest";
import { LessonService } from "@/application/lesson-service";
import type { LessonDetail, LessonRepository } from "@/application/ports/lesson-repository";
import { LessonForbiddenError, LessonInvariantError, LessonNotFoundError, ValidationError } from "@/domain/errors";
import { EDITABLE_STATUSES, type Lesson, type LessonActivation, type LessonStatus, type LessonSummary, type LessonVersion } from "@/domain/lesson";
import type { Permission } from "@/domain/permissions";

/** Repositorio en memoria con las mismas reglas que el de Postgres: huella única, solo `approved` se activa, editar o salir de `approved` desactiva. */
class FakeRepo implements LessonRepository {
  lessons = new Map<string, Lesson>();
  versions = new Map<string, LessonVersion[]>();
  activations = new Map<string, LessonActivation[]>();
  evidence = new Map<string, string[]>();
  private n = 0;

  private summary(id: string): LessonSummary {
    const lesson = this.lessons.get(id)!;
    const current = this.versions.get(id)!.find((v) => v.version === lesson.currentVersion)!;
    return { lesson, current, environments: (this.activations.get(id) ?? []).map((a) => a.environment) };
  }
  async list(experimentId: string, status?: LessonStatus) {
    return [...this.lessons.values()].filter((l) => l.experimentId === experimentId && (!status || l.status === status)).map((l) => this.summary(l.id));
  }
  async get(experimentId: string, id: string): Promise<LessonDetail | null> {
    const l = this.lessons.get(id);
    if (!l || l.experimentId !== experimentId) return null;
    return { summary: this.summary(id), versions: this.versions.get(id)!, evidence: (this.evidence.get(id) ?? []).map((traceId) => ({ traceId, kind: "failure", addedAt: "" })), activations: this.activations.get(id) ?? [], events: [] };
  }
  async create(lesson: Parameters<LessonRepository["create"]>[0], version: Parameters<LessonRepository["create"]>[1], evidence: Parameters<LessonRepository["create"]>[2]) {
    if (lesson.fingerprint && [...this.lessons.values()].some((l) => l.experimentId === lesson.experimentId && l.fingerprint === lesson.fingerprint)) throw new LessonInvariantError("A lesson for this finding already exists");
    const id = `l${++this.n}`;
    this.lessons.set(id, { id, experimentId: lesson.experimentId, status: "proposed", source: lesson.source, fingerprint: lesson.fingerprint, currentVersion: 1, originMetrics: lesson.originMetrics, createdBy: lesson.createdBy, createdAt: "", updatedAt: "" });
    this.versions.set(id, [{ ...version, id: "v1", lessonId: id, version: 1, origin: lesson.source === "mem" ? "mem" : "human", createdBy: lesson.createdBy, createdAt: "" }]);
    this.evidence.set(id, evidence.map((e) => e.traceId));
    return this.summary(id);
  }
  async addVersion(experimentId: string, id: string, v: Parameters<LessonRepository["addVersion"]>[2]) {
    const l = this.lessons.get(id);
    if (!l || l.experimentId !== experimentId) return null;
    if (!EDITABLE_STATUSES.includes(l.status)) throw new LessonInvariantError(`A ${l.status} lesson cannot be edited`);
    const next = l.currentVersion + 1;
    this.versions.get(id)!.push({ ...v, id: `v${next}`, version: next, createdAt: "" });
    this.activations.delete(id);
    this.lessons.set(id, { ...l, currentVersion: next, status: "proposed" });
    return this.summary(id);
  }
  async transition(experimentId: string, id: string, from: LessonStatus, to: LessonStatus) {
    const l = this.lessons.get(id);
    if (!l || l.experimentId !== experimentId) return null;
    if (l.status !== from) throw new LessonInvariantError("changed");
    if (from === "approved") this.activations.delete(id);
    const moved = { ...l, status: to };
    this.lessons.set(id, moved);
    return moved;
  }
  async activate(experimentId: string, id: string, environment: string) {
    const l = this.lessons.get(id);
    if (!l || l.experimentId !== experimentId) return null;
    if (l.status !== "approved") throw new LessonInvariantError("Only an approved lesson can be turned on in an environment");
    const a: LessonActivation = { lessonId: id, environment, version: l.currentVersion, activatedBy: null, activatedAt: "" };
    this.activations.set(id, [...(this.activations.get(id) ?? []).filter((x) => x.environment !== environment), a]);
    return a;
  }
  async deactivate(experimentId: string, id: string, environment: string) {
    const list = this.activations.get(id) ?? [];
    if (!list.some((a) => a.environment === environment)) return false;
    this.activations.set(id, list.filter((a) => a.environment !== environment));
    return true;
  }
}

const EXP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const technical = { userId: "u1", email: "tech@example.com" };
const TECH: Permission[] = ["lesson:read", "lesson:review", "lesson:approve"];
const BUSINESS: Permission[] = ["lesson:read", "lesson:review"];
const body = { title: "No repitas search_flights", guidance: "Si search_flights falla, espera.", match: { tools: ["search_flights"] } };

function setup() {
  const repo = new FakeRepo();
  return { repo, service: new LessonService(repo) };
}

async function approved(service: LessonService) {
  const { lesson } = await service.propose(EXP, technical, body);
  await service.transition(EXP, lesson.id, technical, TECH, { to: "reviewed" });
  await service.transition(EXP, lesson.id, technical, TECH, { to: "approved" });
  return lesson.id;
}

describe("proposing", () => {
  it("a manual lesson has no fingerprint and starts proposed", async () => {
    const { lesson } = await setup().service.propose(EXP, technical, body);
    expect(lesson.status).toBe("proposed");
    expect(lesson.source).toBe("manual");
    expect(lesson.fingerprint).toBeNull();
  });

  it("a lesson from a finding is proposed once: the second time says so", async () => {
    const { service } = setup();
    const first = await service.propose(EXP, technical, { ...body, findingId: "f1", evidenceTraceIds: ["ab".repeat(16)] });
    expect(first.lesson.source).toBe("mem");
    await expect(service.propose(EXP, technical, { ...body, findingId: "f1" })).rejects.toBeInstanceOf(LessonInvariantError);
    await expect(service.propose(OTHER, technical, { ...body, findingId: "f1" })).resolves.toBeDefined(); // otra huella: otro agente
  });

  it("rejects a lesson without trigger and evidence that is not a trace id", async () => {
    const { service } = setup();
    await expect(service.propose(EXP, technical, { ...body, match: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.propose(EXP, technical, { ...body, evidenceTraceIds: ["not-a-trace"] })).rejects.toThrow(/trace ids/);
  });
});

describe("transitions and who may make them", () => {
  it("business can review but not approve", async () => {
    const { service } = setup();
    const { lesson } = await service.propose(EXP, technical, body);
    await service.transition(EXP, lesson.id, technical, BUSINESS, { to: "reviewed" });
    await expect(service.transition(EXP, lesson.id, technical, BUSINESS, { to: "approved" })).rejects.toBeInstanceOf(LessonForbiddenError);
  });

  it("nothing is approved without being reviewed", async () => {
    const { service } = setup();
    const { lesson } = await service.propose(EXP, technical, body);
    await expect(service.transition(EXP, lesson.id, technical, TECH, { to: "approved" })).rejects.toBeInstanceOf(LessonInvariantError);
  });

  it("rejects an unknown status and a lesson of another agent", async () => {
    const { service } = setup();
    const { lesson } = await service.propose(EXP, technical, body);
    await expect(service.transition(EXP, lesson.id, technical, TECH, { to: "active" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.transition(OTHER, lesson.id, technical, TECH, { to: "reviewed" })).rejects.toBeInstanceOf(LessonNotFoundError);
  });
});

describe("serving", () => {
  it("only an approved lesson can be turned on", async () => {
    const { service } = setup();
    const { lesson } = await service.propose(EXP, technical, body);
    await expect(service.activate(EXP, lesson.id, "pro", technical)).rejects.toBeInstanceOf(LessonInvariantError);
    const id = await approved(service);
    expect((await service.activate(EXP, id, "pro", technical)).environment).toBe("pro");
    expect((await service.list(EXP)).find((s) => s.lesson.id === id)!.environments).toEqual(["pro"]);
  });

  it("editing a served lesson makes it a new version, back to proposed and no longer served", async () => {
    const { service } = setup();
    const id = await approved(service);
    await service.activate(EXP, id, "pro", technical);
    const edited = await service.edit(EXP, id, technical, { ...body, guidance: "Otro texto." });
    expect(edited.lesson.status).toBe("proposed");
    expect(edited.lesson.currentVersion).toBe(2);
    expect(edited.environments).toEqual([]);
  });

  it("retiring a served lesson stops serving it, and a retired lesson cannot be edited", async () => {
    const { service } = setup();
    const id = await approved(service);
    await service.activate(EXP, id, "pro", technical);
    await service.transition(EXP, id, technical, TECH, { to: "retired" });
    expect((await service.get(EXP, id)).activations).toEqual([]);
    await expect(service.edit(EXP, id, technical, body)).rejects.toBeInstanceOf(LessonInvariantError);
  });

  it("turning it off where it was not on is a not found", async () => {
    const { service } = setup();
    const id = await approved(service);
    await expect(service.deactivate(EXP, id, "pro", technical)).rejects.toBeInstanceOf(LessonNotFoundError);
  });

  it("validates the environment key", async () => {
    const { service } = setup();
    const id = await approved(service);
    await expect(service.activate(EXP, id, "Pro!", technical)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listing", () => {
  it("filters by status and rejects an unknown one", async () => {
    const { service } = setup();
    await service.propose(EXP, technical, body);
    await approved(service);
    expect(await service.list(EXP, "approved")).toHaveLength(1);
    expect(await service.list(EXP)).toHaveLength(2);
    expect(() => service.list(EXP, "nope")).toThrow(ValidationError);
  });
});
