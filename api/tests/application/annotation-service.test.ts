import { beforeEach, describe, expect, it } from "vitest";
import { AnnotationService } from "@/application/annotation-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { TraceSpans } from "@/application/ports/trace-repository";
import type { TraceScore } from "@/domain/annotation";
import {
  AnnotationForbiddenError,
  AnnotationValueError,
  ScoreConfigInvariantError,
  ScoreConfigNotFoundError,
  ScoreConfigShapeError,
  SpanNotFoundError,
  TraceNotFoundError,
} from "@/domain/errors";
import { FakeAnnotationRepository, FakeScoreConfigRepository, FakeTraceRepository, span } from "../helpers";

const numeric = { name: "tone", dataType: "numeric" as const, minValue: 1, maxValue: 5, categories: null, description: null };

describe("AnnotationService score configs", () => {
  let repo: FakeScoreConfigRepository;
  let service: AnnotationService;
  beforeEach(() => {
    repo = new FakeScoreConfigRepository();
    service = new AnnotationService(repo, new FakeAnnotationRepository(), new FakeTraceRepository(), {} as ScoreRepository, {} as IdentityRepository);
  });

  it("validates before persisting", async () => {
    await expect(service.createScoreConfig("e1", "u1", { ...numeric, minValue: 9 })).rejects.toBeInstanceOf(ScoreConfigShapeError);
    expect(repo.configs).toEqual([]);
  });

  it("rejects a duplicate active name but allows reusing an archived one", async () => {
    const first = await service.createScoreConfig("e1", "u1", numeric);
    await expect(service.createScoreConfig("e1", "u1", numeric)).rejects.toBeInstanceOf(ScoreConfigInvariantError);
    await service.archiveScoreConfig("e1", first.id);
    await expect(service.createScoreConfig("e1", "u1", numeric)).resolves.toMatchObject({ name: "tone" });
  });

  it("same name in another experiment is fine", async () => {
    await service.createScoreConfig("e1", "u1", numeric);
    await expect(service.createScoreConfig("e2", "u1", numeric)).resolves.toBeDefined();
  });

  it("hides archived configs unless asked", async () => {
    const config = await service.createScoreConfig("e1", "u1", numeric);
    await service.archiveScoreConfig("e1", config.id);
    expect(await service.listScoreConfigs("e1")).toEqual([]);
    expect(await service.listScoreConfigs("e1", true)).toHaveLength(1);
  });

  it("fails to unarchive when the name is now taken", async () => {
    const old = await service.createScoreConfig("e1", "u1", numeric);
    await service.archiveScoreConfig("e1", old.id);
    await service.createScoreConfig("e1", "u1", numeric);
    await expect(service.unarchiveScoreConfig("e1", old.id)).rejects.toBeInstanceOf(ScoreConfigInvariantError);
  });

  it("widens a range through update and rejects narrowing", async () => {
    const config = await service.createScoreConfig("e1", "u1", numeric);
    expect(await service.updateScoreConfig("e1", config.id, { maxValue: 10 })).toMatchObject({ minValue: 1, maxValue: 10 });
    await expect(service.updateScoreConfig("e1", config.id, { maxValue: 3 })).rejects.toBeInstanceOf(ScoreConfigInvariantError);
  });

  it("reports unknown configs, including ones from another experiment", async () => {
    const config = await service.createScoreConfig("e1", "u1", numeric);
    await expect(service.updateScoreConfig("e2", config.id, { description: "x" })).rejects.toBeInstanceOf(ScoreConfigNotFoundError);
    await expect(service.archiveScoreConfig("e1", "nope")).rejects.toBeInstanceOf(ScoreConfigNotFoundError);
  });
});

describe("AnnotationService annotations (ADR-037)", () => {
  const SERVICE = "svc";
  const actor = { userId: "u1", experimentId: "e1", serviceName: SERVICE };
  const traceSpans = (serviceName = SERVICE, spanIds = ["aaaaaaaaaaaaaaaa"]): TraceSpans => ({
    spans: spanIds.map((spanId) => span({ spanId, serviceName })),
    truncated: false,
  });

  let configs: FakeScoreConfigRepository;
  let annotationsRepo: FakeAnnotationRepository;
  let traces: FakeTraceRepository;
  let service: AnnotationService;
  let clock: number;
  let scoresByTrace: TraceScore[];
  let users: Array<{ id: string; name: string | null }>;
  let configId: string;

  beforeEach(async () => {
    configs = new FakeScoreConfigRepository();
    annotationsRepo = new FakeAnnotationRepository();
    traces = new FakeTraceRepository();
    traces.traces.set("t1", traceSpans());
    clock = Date.parse("2026-10-03T10:00:00.000Z");
    scoresByTrace = [];
    users = [
      { id: "u1", name: "Ana" },
      { id: "u2", name: null },
    ];
    const scoreRepo = { listScoresByTrace: async () => scoresByTrace } as unknown as ScoreRepository;
    const identity = { getUsersByIds: async (ids: string[]) => users.filter((u) => ids.includes(u.id)) } as unknown as IdentityRepository;
    service = new AnnotationService(configs, annotationsRepo, traces, scoreRepo, identity, () => new Date((clock += 1000)));
    configId = (await service.createScoreConfig("e1", "u1", numeric)).id;
  });

  it("stores the validated, normalized value with the authenticated user as annotator", async () => {
    await service.saveAnnotation(actor, "t1", { configId, value: " 4 ", comment: "  nice  " });
    const [stored] = await annotationsRepo.listForTrace(SERVICE, "t1");
    expect(stored).toMatchObject({ annotatorId: "u1", value: "4", comment: "nice", configName: "tone", dataType: "numeric", spanId: null });
  });

  it("rejects values the config does not accept, without writing", async () => {
    await expect(service.saveAnnotation(actor, "t1", { configId, value: 9 })).rejects.toBeInstanceOf(AnnotationValueError);
    expect(annotationsRepo.rows).toEqual([]);
  });

  it("rejects archived and unknown configs", async () => {
    await expect(service.saveAnnotation(actor, "t1", { configId: "nope", value: 3 })).rejects.toBeInstanceOf(ScoreConfigNotFoundError);
    await service.archiveScoreConfig("e1", configId);
    await expect(service.saveAnnotation(actor, "t1", { configId, value: 3 })).rejects.toBeInstanceOf(ScoreConfigInvariantError);
  });

  it("rejects a config from another experiment", async () => {
    await expect(service.saveAnnotation({ ...actor, experimentId: "e2" }, "t1", { configId, value: 3 })).rejects.toBeInstanceOf(ScoreConfigNotFoundError);
  });

  it("rejects traces that do not exist or belong to another tenant, as if they did not exist", async () => {
    traces.traces.set("foreign", traceSpans("other-service"));
    await expect(service.saveAnnotation(actor, "missing", { configId, value: 3 })).rejects.toBeInstanceOf(TraceNotFoundError);
    await expect(service.saveAnnotation(actor, "foreign", { configId, value: 3 })).rejects.toBeInstanceOf(TraceNotFoundError);
    expect(annotationsRepo.rows).toEqual([]);
  });

  it("checks that the span belongs to the trace, unless the trace was truncated", async () => {
    await expect(service.saveAnnotation(actor, "t1", { configId, value: 3, spanId: "bbbbbbbbbbbbbbbb" })).rejects.toBeInstanceOf(SpanNotFoundError);
    await expect(service.saveAnnotation(actor, "t1", { configId, value: 3, spanId: "aaaaaaaaaaaaaaaa" })).resolves.toMatchObject({ spanId: "aaaaaaaaaaaaaaaa" });
    traces.traces.set("big", { ...traceSpans(), truncated: true });
    await expect(service.saveAnnotation(actor, "big", { configId, value: 3, spanId: "bbbbbbbbbbbbbbbb" })).resolves.toBeDefined();
  });

  it("an edit replaces the author's label while other annotators coexist", async () => {
    await service.saveAnnotation(actor, "t1", { configId, value: 2 });
    await service.saveAnnotation({ ...actor, userId: "u2" }, "t1", { configId, value: 5 });
    await service.saveAnnotation(actor, "t1", { configId, value: 4 });
    const { annotations } = await service.listForTrace(SERVICE, "t1");
    expect(annotations.map((a) => [a.annotatorId, a.value]).sort()).toEqual([["u1", "4"], ["u2", "5"]]);
  });

  it("lists annotator names (null for unnamed or former members) next to automatic scores", async () => {
    scoresByTrace = [{ datasetRunId: "r1", itemIndex: 0, name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: null }];
    await service.saveAnnotation(actor, "t1", { configId, value: 3 });
    await service.saveAnnotation({ ...actor, userId: "gone" }, "t1", { configId, value: 3 });
    const { annotations, scores } = await service.listForTrace(SERVICE, "t1");
    expect(Object.fromEntries(annotations.map((a) => [a.annotatorId, a.annotatorName]))).toEqual({ u1: "Ana", gone: null });
    expect(scores).toEqual(scoresByTrace);
  });

  it("retracts only the caller's own annotation and is idempotent", async () => {
    await service.saveAnnotation(actor, "t1", { configId, value: 3 });
    await service.saveAnnotation({ ...actor, userId: "u2" }, "t1", { configId, value: 4 });
    await service.retractAnnotation(actor, "t1", { configId, actorIsAdmin: false });
    await service.retractAnnotation(actor, "t1", { configId, actorIsAdmin: false });
    expect((await service.listForTrace(SERVICE, "t1")).annotations.map((a) => a.annotatorId)).toEqual(["u2"]);
  });

  it("only admins retract someone else's annotation, leaving who did it in the tombstone", async () => {
    await service.saveAnnotation({ ...actor, userId: "u2" }, "t1", { configId, value: 4 });
    await expect(service.retractAnnotation(actor, "t1", { configId, annotatorId: "u2", actorIsAdmin: false })).rejects.toBeInstanceOf(AnnotationForbiddenError);
    await service.retractAnnotation(actor, "t1", { configId, annotatorId: "u2", actorIsAdmin: true });
    expect((await service.listForTrace(SERVICE, "t1")).annotations).toEqual([]);
    expect(annotationsRepo.rows[0]).toMatchObject({ isDeleted: true, annotation: { comment: "Retracted by admin u1", annotatorId: "u2" } });
  });

  it("can retract a label whose config was archived afterwards", async () => {
    await service.saveAnnotation(actor, "t1", { configId, value: 3 });
    await service.archiveScoreConfig("e1", configId);
    await service.retractAnnotation(actor, "t1", { configId, actorIsAdmin: false });
    expect((await service.listForTrace(SERVICE, "t1")).annotations).toEqual([]);
  });
});
