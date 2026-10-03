import { beforeEach, describe, expect, it } from "vitest";
import { DatasetPromotionService } from "@/application/dataset-promotion-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { Annotation } from "@/domain/annotation";
import type { DatasetItem } from "@/domain/identity";
import { FakeAnnotationRepository, FakeTraceRepository, span } from "../helpers";

const actor = { userId: "u1", serviceName: "svc" };
const NOW = new Date("2026-10-03T12:00:00Z");

/** Solo lo que usa el servicio: reproduce el filtro de duplicados que en Postgres hace el lock + SELECT. */
class StubIdentity {
  calls: Array<Array<{ traceId: string; input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> }>> = [];
  existing = new Set<string>();
  async addPromotedDatasetItems(_datasetId: string, _userId: string, items: StubIdentity["calls"][number]) {
    this.calls.push(items);
    const fresh = items.filter((i) => !this.existing.has(i.traceId));
    const alreadyPromoted = items.filter((i) => this.existing.has(i.traceId)).map((i) => i.traceId);
    const added = fresh.map((i) => ({ id: i.traceId, input: i.input, expectedOutput: i.expectedOutput, metadata: i.metadata }) as unknown as DatasetItem);
    return { added, alreadyPromoted, version: fresh.length ? ({ major: 2, minor: 0 } as never) : null };
  }
}

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  traceId: "t1",
  spanId: null,
  configId: "c1",
  configName: "correct_answer",
  dataType: "categorical",
  annotatorId: "u2",
  value: "Paris",
  comment: null,
  createdAt: "2026-10-03T10:00:00Z",
  ...overrides,
});

describe("DatasetPromotionService", () => {
  let traces: FakeTraceRepository;
  let annotations: FakeAnnotationRepository;
  let identity: StubIdentity;
  let service: DatasetPromotionService;

  beforeEach(() => {
    traces = new FakeTraceRepository();
    annotations = new FakeAnnotationRepository();
    identity = new StubIdentity();
    service = new DatasetPromotionService(identity as unknown as IdentityRepository, traces, annotations, () => NOW);
    traces.traces.set("t1", { truncated: false, spans: [span({ attributes: { "memtrace.input": "capital of France?", "memtrace.output": "Lyon" } })] });
  });

  it("promotes a batch in ONE repository call with provenance metadata", async () => {
    traces.traces.set("t2", { truncated: false, spans: [span({ attributes: { "memtrace.input": "second" } })] });
    await annotations.upsert("svc", annotation());
    const result = await service.promoteTraces(actor, "d1", [{ traceId: "t1", fromConfigId: "c1" }, { traceId: "t2", expectedOutput: "typed" }]);

    expect(identity.calls).toHaveLength(1);
    expect(result.added).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    const [first, second] = identity.calls[0]!;
    expect(first).toMatchObject({ traceId: "t1", input: "capital of France?", expectedOutput: "Paris" });
    expect(first!.metadata.promotedFrom).toMatchObject({ traceId: "t1", promotedBy: "u1", promotedAt: NOW.toISOString(), observedOutput: "Lyon" });
    expect(second).toMatchObject({ traceId: "t2", expectedOutput: "typed" });
  });

  it("skips unknown traces, traces of another tenant and traces without content, without failing the batch", async () => {
    traces.traces.set("other", { truncated: false, spans: [span({ serviceName: "someone-else", attributes: { "memtrace.input": "x" } })] });
    traces.traces.set("empty", { truncated: false, spans: [span({ name: "eval.item" })] });
    const result = await service.promoteTraces(actor, "d1", [{ traceId: "t1" }, { traceId: "missing" }, { traceId: "other" }, { traceId: "empty" }]);

    expect(result.added.map((i) => i.id)).toEqual(["t1"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { traceId: "missing", reason: "not_found" },
        { traceId: "other", reason: "not_found" },
        { traceId: "empty", reason: "no_content" },
      ]),
    );
  });

  it("reports ambiguous and unsupported labels instead of guessing", async () => {
    await annotations.upsert("svc", annotation());
    await annotations.upsert("svc", annotation({ annotatorId: "u3", value: "Lyon" }));
    const ambiguous = await service.promoteTraces(actor, "d1", [{ traceId: "t1", fromConfigId: "c1" }]);
    expect(ambiguous.skipped).toEqual([{ traceId: "t1", reason: "ambiguous_label" }]);
    // explicit answer resolves the disagreement
    const typed = await service.promoteTraces(actor, "d1", [{ traceId: "t1", fromConfigId: "c1", expectedOutput: "Paris" }]);
    expect(typed.added).toHaveLength(1);
  });

  it("does not create a version when every trace is skipped", async () => {
    const result = await service.promoteTraces(actor, "d1", [{ traceId: "missing" }]);
    expect(identity.calls).toHaveLength(0);
    expect(result).toEqual({ added: [], skipped: [{ traceId: "missing", reason: "not_found" }], version: null });
  });

  it("reports duplicates inside the request and ones already promoted in the dataset", async () => {
    identity.existing.add("t1");
    traces.traces.set("t2", { truncated: false, spans: [span({ attributes: { "memtrace.input": "second" } })] });
    const result = await service.promoteTraces(actor, "d1", [{ traceId: "t1" }, { traceId: "t2" }, { traceId: "t2" }]);

    expect(result.added.map((i) => i.id)).toEqual(["t2"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { traceId: "t2", reason: "already_promoted" },
        { traceId: "t1", reason: "already_promoted" },
      ]),
    );
  });

  it("lets the person replace the extracted input (e.g. after scrubbing personal data)", async () => {
    const result = await service.promoteTraces(actor, "d1", [{ traceId: "t1", input: "capital of [country]?" }]);
    expect(result.added).toHaveLength(1);
    expect(identity.calls[0]![0]).toMatchObject({ input: "capital of [country]?" });
    expect(identity.calls[0]![0]!.metadata.promotedFrom).toMatchObject({ observedOutput: "Lyon" });
  });
});
