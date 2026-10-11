/**
 * Rutas de calidad por modelo (ADR-025) con el servicio real y repositorios en memoria: se comprueba quién puede qué y cómo responde la
 * API a lo que está mal; la lógica de nombres tiene sus propios tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "@/application/audit-service";
import { ModelQualityService } from "@/application/model-quality-service";
import type { AuditEntryInput } from "@/domain/audit";
import type { ArenaModel } from "@/domain/model-quality";
import { FakeTraceRepository } from "../helpers";
import { FakeModelQualityRepository } from "../support/fake-model-quality-repository";

const state = {
  user: { id: "u1", email: "ana@example.com", name: "Ana", image: null } as { id: string; email: string; name: string | null; image: string | null } | null,
  permissions: [] as string[],
  experiments: [] as Array<{ id: string; organizationId: string; serviceName: string; permissions: string[] }>,
  traces: new FakeTraceRepository(),
  decisions: new FakeModelQualityRepository(),
  audit: [] as AuditEntryInput[],
};

vi.mock("@/adapters/inbound/http/auth-context", () => ({
  requireUser: async () => state.user ?? new Response(JSON.stringify({ status: 401 }), { status: 401 }),
  requirePermission: async (id: string, permission: string) => {
    if (!state.user) return new Response(JSON.stringify({ status: 401 }), { status: 401 });
    if (!state.permissions.includes(permission)) return new Response(JSON.stringify({ status: 403, detail: `Missing permission: ${permission}` }), { status: 403 });
    return { user: state.user, scope: { experimentId: id, serviceName: "weather" }, serviceName: "weather", organizationId: "org1", role: "technical", permissions: state.permissions };
  },
}));

vi.mock("@/dependency-container", () => ({
  getModelQuality: () =>
    new ModelQualityService(state.traces, state.decisions, new AuditService({ append: async (e) => void state.audit.push(e), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 })),
  getIdentity: () => ({ identityRepository: { listExperimentsForUser: async () => state.experiments } }),
}));

const overview = await import("@/app/api/v1/experiments/[experimentId]/model-quality/route");
const candidates = await import("@/app/api/v1/experiments/[experimentId]/model-quality/candidates/route");
const matches = await import("@/app/api/v1/experiments/[experimentId]/model-quality/matches/[modelKey]/route");
const pending = await import("@/app/api/v1/model-quality/pending/route");

const exp = { params: Promise.resolve({ experimentId: "exp1" }) };
const model = (key: string) => ({ params: Promise.resolve({ experimentId: "exp1", modelKey: key }) });
const send = (method: string, body?: unknown) => new Request("http://x/", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const arena = (modelName: string, rating: number): ArenaModel => ({ modelName, organization: "x", license: "Proprietary", rating, ratingLower: rating - 3, ratingUpper: rating + 3, voteCount: 100, rank: 5, publishedAtMs: 1, updatedAtMs: 1 });
const price = (modelId: string) => ({ modelId, provider: "p", inputPricePerToken: 1, outputPricePerToken: 1, source: "litellm", updatedAtMs: 1 });

beforeEach(() => {
  state.user = { id: "u1", email: "ana@example.com", name: "Ana", image: null };
  state.permissions = [];
  state.experiments = [];
  state.traces = new FakeTraceRepository();
  state.traces.modelPricing = [price("claude-sonnet-4-5"), price("gpt-5.2")];
  state.traces.modelQuality = [arena("claude-sonnet-4-5-20250929", 1439), arena("gpt-5.2", 1412)];
  state.traces.modelsInUse = ["claude-sonnet-4-5"];
  state.decisions = new FakeModelQualityRepository();
  state.audit = [];
});

describe("reading the scores", () => {
  it("needs a session", async () => {
    state.user = null;
    expect((await overview.GET(send("GET"), exp)).status).toBe(401);
  });

  it("needs experiment:read", async () => {
    state.permissions = ["pricing:manage"];
    expect((await overview.GET(send("GET"), exp)).status).toBe(403);
  });

  it("returns the source, the scores and the candidates", async () => {
    state.permissions = ["experiment:read"];
    const res = await overview.GET(send("GET"), exp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toMatchObject({ name: "Arena", license: "CC BY 4.0" });
    expect(body.items.map((i: { modelId: string; state: string }) => [i.modelId, i.state])).toEqual([["claude-sonnet-4-5", "candidate"], ["gpt-5.2", "matched"]]);
    expect(body.counts).toEqual({ needsReview: 1, pending: 1, inUse: 1 });
  });
});

describe("deciding needs pricing:manage", () => {
  it("lists candidates only with the permission", async () => {
    state.permissions = ["experiment:read"];
    expect((await candidates.GET(send("GET"), exp)).status).toBe(403);
    state.permissions = ["pricing:manage"];
    const res = await candidates.GET(send("GET"), exp);
    expect(res.status).toBe(200);
    expect((await res.json()).items.map((g: { modelKey: string }) => g.modelKey)).toEqual(["claude-sonnet-4-5"]);
  });

  it("rejects an unknown scope", async () => {
    state.permissions = ["pricing:manage"];
    expect((await candidates.GET(new Request("http://x/?scope=everything"), exp)).status).toBe(400);
  });

  it("refuses to decide without the permission and changes nothing", async () => {
    state.permissions = ["experiment:read", "alert:manage"];
    expect((await matches.PUT(send("PUT", { decision: "no_equivalent" }), model("claude-sonnet-4-5"))).status).toBe(403);
    expect(state.decisions.rows).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it("confirms a match, answers 204, and the score shows up", async () => {
    state.permissions = ["pricing:manage", "experiment:read"];
    const res = await matches.PUT(send("PUT", { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929" }), model("claude-sonnet-4-5"));
    expect(res.status).toBe(204);
    expect(state.audit[0]).toMatchObject({ action: "model_match.update", organizationId: "org1", actorLabel: "ana@example.com", targetId: "claude-sonnet-4-5" });
    const body = await (await overview.GET(send("GET"), exp)).json();
    expect(body.items[0]).toMatchObject({ modelId: "claude-sonnet-4-5", state: "matched", quality: { elo: 1439, origin: "confirmed" } });
  });

  it("reads a url-encoded model key", async () => {
    state.permissions = ["pricing:manage"];
    expect((await matches.PUT(send("PUT", { decision: "no_equivalent" }), model(encodeURIComponent("Claude-Sonnet-4-5")))).status).toBe(204);
  });

  it.each([
    [{ decision: "confirm" }],
    [{ decision: "confirm", arenaName: "" }],
    [{ decision: "reject", arenaNames: [] }],
    [{ decision: "maybe" }],
    [{}],
  ])("answers 400 to a malformed body %j", async (body) => {
    state.permissions = ["pricing:manage"];
    expect((await matches.PUT(send("PUT", body), model("claude-sonnet-4-5"))).status).toBe(400);
  });

  it("answers 400 to a model that is not in the catalog or an entry Arena does not list", async () => {
    state.permissions = ["pricing:manage"];
    expect((await matches.PUT(send("PUT", { decision: "no_equivalent" }), model("made-up"))).status).toBe(400);
    expect((await matches.PUT(send("PUT", { decision: "confirm", arenaName: "nope" }), model("claude-sonnet-4-5"))).status).toBe(400);
  });

  it("answers 400 to a body that is not JSON", async () => {
    state.permissions = ["pricing:manage"];
    const res = await matches.PUT(new Request("http://x/", { method: "PUT", body: "{" }), model("claude-sonnet-4-5"));
    expect(res.status).toBe(400);
  });

  it("clears a decision, and says 404 when there was none", async () => {
    state.permissions = ["pricing:manage"];
    expect((await matches.DELETE(send("DELETE"), model("claude-sonnet-4-5"))).status).toBe(404);
    await matches.PUT(send("PUT", { decision: "no_equivalent" }), model("claude-sonnet-4-5"));
    expect((await matches.DELETE(send("DELETE"), model("claude-sonnet-4-5"))).status).toBe(204);
    expect(state.decisions.rows).toEqual([]);
  });
});

describe("the bell", () => {
  it("needs a session", async () => {
    state.user = null;
    expect((await pending.GET()).status).toBe(401);
  });

  it("counts only the agents where the person can decide", async () => {
    state.experiments = [
      { id: "exp1", organizationId: "org1", serviceName: "weather", permissions: ["experiment:read", "pricing:manage"] },
      { id: "exp2", organizationId: "org1", serviceName: "rag", permissions: ["experiment:read"] },
    ];
    const body = await (await pending.GET()).json();
    expect(body).toEqual({ total: 1, items: [{ experimentId: "exp1", modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", candidateCount: 1 }] });
    expect(state.traces.lastModelsInUseScopes.map((s) => s.experimentId)).toEqual(["exp1"]);
  });

  it("is empty for someone who cannot decide anywhere", async () => {
    state.experiments = [{ id: "exp2", organizationId: "org1", serviceName: "rag", permissions: ["experiment:read"] }];
    expect(await (await pending.GET()).json()).toEqual({ total: 0, items: [] });
  });
});
