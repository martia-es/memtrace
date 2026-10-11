import { beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "@/application/audit-service";
import { ModelQualityService, type ExperimentRef } from "@/application/model-quality-service";
import type { AuditEntryInput } from "@/domain/audit";
import { ValidationError } from "@/domain/errors";
import type { ArenaModel } from "@/domain/model-quality";
import type { ModelPricing } from "@/domain/pricing";
import { FakeTraceRepository } from "../helpers";
import { FakeModelQualityRepository } from "../support/fake-model-quality-repository";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const PUBLISHED = Date.parse("2026-10-08T00:00:00Z");
const SYNCED = Date.parse("2026-10-10T03:00:00Z");

const arena = (modelName: string, rating: number, voteCount: number, rank: number): ArenaModel => ({
  modelName, organization: "x", license: "Proprietary", rating, ratingLower: rating - 4, ratingUpper: rating + 4, voteCount, rank, publishedAtMs: PUBLISHED, updatedAtMs: SYNCED,
});
const price = (modelId: string): ModelPricing => ({ modelId, provider: "p", inputPricePerToken: 1e-6, outputPricePerToken: 2e-6, source: "litellm", updatedAtMs: NOW });

const ref = (organizationId = "org1", experimentId = "exp1"): ExperimentRef & { experimentId: string } => ({ organizationId, experimentId, scope: { experimentId, serviceName: `svc-${experimentId}` } });
const actor = { userId: "u1", email: "ana@example.com" };

let traces: FakeTraceRepository;
let decisions: FakeModelQualityRepository;
let audit: AuditEntryInput[];
let service: ModelQualityService;
let clock = NOW;

beforeEach(() => {
  traces = new FakeTraceRepository();
  traces.modelPricing = ["claude-opus-4-7", "claude-sonnet-4-5", "gemini-3-flash-preview", "azure/gpt-5.2", "gpt-5.2", "mistral-large"].map(price);
  traces.modelQuality = [
    arena("claude-opus-4-7", 1483, 66315, 15),
    arena("claude-sonnet-4-5-20250929", 1439, 82735, 79),
    arena("claude-sonnet-4-5-20250929-high-32k", 1435, 83973, 88),
    arena("gemini-3-flash", 1466, 31337, 35),
    arena("gpt-5.2", 1412, 83928, 135),
  ];
  traces.modelsInUse = ["claude-sonnet-4-5", "gemini-3-flash-preview", "gpt-5.2"];
  decisions = new FakeModelQualityRepository();
  audit = [];
  service = new ModelQualityService(traces, decisions, new AuditService({ append: async (e) => void audit.push(e), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 }), () => clock);
  clock = NOW;
});

describe("overview", () => {
  it("says where the numbers come from and how fresh they are", async () => {
    const { source } = await service.overview(ref());
    expect(source).toMatchObject({ name: "Arena", board: "text", category: "overall", license: "CC BY 4.0", url: "https://arena.ai", publishedAt: "2026-10-08T00:00:00.000Z", syncedAt: "2026-10-10T03:00:00.000Z" });
  });

  it("has no dates before the worker has synced anything", async () => {
    traces.modelQuality = [];
    expect((await service.overview(ref())).source).toMatchObject({ publishedAt: null, syncedAt: null });
  });

  it("lists matched, candidate and in-use models, and leaves out the ones with nothing to say", async () => {
    const { items, counts } = await service.overview(ref());
    expect(items.map((i) => [i.modelId, i.state, i.inUse])).toEqual([
      ["claude-opus-4-7", "matched", false],
      ["claude-sonnet-4-5", "candidate", true],
      ["gemini-3-flash-preview", "candidate", true],
      ["azure/gpt-5.2", "matched", true],
      ["gpt-5.2", "matched", true],
    ]);
    expect(counts).toEqual({ needsReview: 2, pending: 2, inUse: 3 });
  });

  it("asks only for the models of this experiment, over the last 30 days", async () => {
    await service.overview(ref("org1", "exp9"));
    expect(traces.lastModelsInUseScopes).toEqual([{ experimentId: "exp9", serviceName: "svc-exp9" }]);
  });

  it("applies the decisions of this organization and no other", async () => {
    await service.decide(ref("org1"), actor, "claude-sonnet-4-5", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929" });
    const mine = (await service.overview(ref("org1"))).items.find((i) => i.modelId === "claude-sonnet-4-5")!;
    const theirs = (await service.overview(ref("org2"))).items.find((i) => i.modelId === "claude-sonnet-4-5")!;
    expect(mine).toMatchObject({ state: "matched", quality: { arenaName: "claude-sonnet-4-5-20250929", elo: 1439, origin: "confirmed" } });
    expect(theirs.state).toBe("candidate");
  });
});

describe("candidates", () => {
  it("lists every candidate of each undecided model, models in use first", async () => {
    traces.modelsInUse = ["gemini-3-flash-preview"];
    const groups = await service.candidates(ref(), "all");
    expect(groups.map((g) => [g.modelKey, g.inUse])).toEqual([["gemini-3-flash-preview", true], ["claude-sonnet-4-5", false]]);
    expect(groups[1]!.candidates.map((c) => c.arenaName)).toEqual(["claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929-high-32k"]);
  });

  it("scope in_use leaves out the models nobody calls", async () => {
    traces.modelsInUse = ["gemini-3-flash-preview"];
    expect((await service.candidates(ref(), "in_use")).map((g) => g.modelKey)).toEqual(["gemini-3-flash-preview"]);
  });

  it("does not offer again what was rejected, and a decided model leaves the list", async () => {
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "reject", arenaNames: ["claude-sonnet-4-5-20250929"] });
    expect((await service.candidates(ref(), "all")).find((g) => g.modelKey === "claude-sonnet-4-5")!.candidates.map((c) => c.arenaName)).toEqual(["claude-sonnet-4-5-20250929-high-32k"]);
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "no_equivalent" });
    expect((await service.candidates(ref(), "all")).map((g) => g.modelKey)).toEqual(["gemini-3-flash-preview"]);
  });
});

describe("deciding", () => {
  it("confirms, replaces an earlier confirmation, and writes the audit log", async () => {
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929" });
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929-high-32k" });
    expect(decisions.rows.filter((r) => r.decision === "confirmed").map((r) => r.arenaModelName)).toEqual(["claude-sonnet-4-5-20250929-high-32k"]);
    expect(audit.map((e) => [e.action, e.organizationId, e.experimentId, e.actorLabel, e.targetId, e.metadata])).toEqual([
      ["model_match.update", "org1", "exp1", "ana@example.com", "claude-sonnet-4-5", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929" }],
      ["model_match.update", "org1", "exp1", "ana@example.com", "claude-sonnet-4-5", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929-high-32k" }],
    ]);
  });

  it("accepts the key however the client spells it", async () => {
    await service.decide(ref(), actor, "Azure/Claude-Sonnet-4-5", { decision: "no_equivalent" });
    expect(decisions.rows[0]).toMatchObject({ modelKey: "claude-sonnet-4-5", decision: "no_equivalent", arenaModelName: "" });
  });

  it("refuses a model that is not in the catalog", async () => {
    await expect(service.decide(ref(), actor, "made-up-model", { decision: "no_equivalent" })).rejects.toBeInstanceOf(ValidationError);
    expect(decisions.rows).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("refuses an Arena entry that does not exist", async () => {
    await expect(service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "confirm", arenaName: "nope" })).rejects.toMatchObject({ fields: { arenaName: expect.any(String) } });
    await expect(service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "reject", arenaNames: ["claude-sonnet-4-5-20250929", "nope"] })).rejects.toBeInstanceOf(ValidationError);
    expect(decisions.rows).toEqual([]);
  });

  it("clearing goes back to the automatic result and is audited only when something changed", async () => {
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "no_equivalent" });
    expect(await service.clear(ref(), actor, "claude-sonnet-4-5")).toBe(true);
    expect(await service.clear(ref(), actor, "claude-sonnet-4-5")).toBe(false);
    expect(audit.map((e) => e.metadata)).toEqual([{ decision: "no_equivalent" }, { decision: "clear" }]);
    expect((await service.overview(ref())).items.find((i) => i.modelId === "claude-sonnet-4-5")!.state).toBe("candidate");
  });
});

describe("pending (the bell)", () => {
  it("counts the models in use that wait for a decision, once per organization", async () => {
    const result = await service.pending([ref("org1", "exp1"), ref("org1", "exp2")]);
    expect(result).toEqual({
      total: 2,
      items: [
        { experimentId: "exp1", modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", candidateCount: 2 },
        { experimentId: "exp1", modelKey: "gemini-3-flash-preview", model: "gemini-3-flash-preview", candidateCount: 1 },
      ],
    });
  });

  it("asks only about the agents the person manages", async () => {
    await service.pending([ref("org1", "exp1"), ref("org1", "exp2")]);
    expect(traces.lastModelsInUseScopes.map((s) => s.experimentId)).toEqual(["exp1", "exp2"]);
  });

  it("a model somebody already decided is no longer pending, and a model nobody uses never is", async () => {
    await service.decide(ref(), actor, "claude-sonnet-4-5", { decision: "no_equivalent" });
    traces.modelsInUse = ["claude-sonnet-4-5", "claude-opus-4-7"];
    expect((await service.pending([ref()])).total).toBe(0);
  });

  it("is empty for a person who manages nothing", async () => {
    expect(await service.pending([])).toEqual({ total: 0, items: [] });
  });
});

describe("the models in use are remembered for a few minutes", () => {
  it("asks ClickHouse once for the same experiments, and again after the cache expires or for other experiments", async () => {
    await service.overview(ref());
    await service.overview(ref());
    await service.pending([ref()]);
    expect(traces.modelsInUseCalls).toBe(1);
    await service.overview(ref("org1", "exp2"));
    expect(traces.modelsInUseCalls).toBe(2);
    clock += 6 * 60 * 1000;
    await service.overview(ref());
    expect(traces.modelsInUseCalls).toBe(3);
  });
});
