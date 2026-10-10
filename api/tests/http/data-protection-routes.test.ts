/**
 * Las rutas de retención, auditoría y exportación (ADR-084) son las que más datos pueden sacar o cambiar: aquí se comprueba que
 * cada una cierra la puerta sin el permiso exacto, con los módulos de sesión y de composición sustituidos por dobles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  user: { id: "u1", email: "ana@example.com", name: "Ana", image: null } as { id: string; email: string; name: string | null; image: string | null } | null,
  orgPermissions: [] as string[],
  experimentPermissions: [] as string[],
  audit: [] as unknown[],
  exportStarted: [] as unknown[],
  exportPreviews: [] as unknown[],
};

vi.mock("@/adapters/inbound/http/auth-context", () => ({
  requireUser: async () => state.user ?? new Response(JSON.stringify({ status: 401 }), { status: 401 }),
  requirePermission: async (_experimentId: string, permission: string) => {
    if (!state.user) return new Response(JSON.stringify({ status: 401 }), { status: 401 });
    if (!state.experimentPermissions.includes(permission)) return new Response(JSON.stringify({ status: 403, detail: `Missing permission: ${permission}` }), { status: 403 });
    return { user: state.user, serviceName: "weather", scope: { experimentId: "exp1", serviceName: "weather" }, organizationId: "org1", role: "technical", permissions: state.experimentPermissions };
  },
}));

vi.mock("@/dependency-container", () => ({
  getIdentity: () => ({
    authorizationService: { canInOrganization: async (_u: string, _o: string, p: string) => state.orgPermissions.includes(p) },
    identityRepository: { getExperiment: async () => ({ id: "exp1", organizationId: "org1", name: "Weather", serviceName: "weather" }) },
  }),
  getRetention: () => ({
    getPolicy: async () => ({ organizationId: "org1", defaultDays: 30, minDays: 1, maxDays: 365, experiments: [] }),
    setOrganizationDefault: async (_o: string, days: number) => ({ organizationId: "org1", defaultDays: days, minDays: 1, maxDays: 365, experiments: [] }),
    setExperimentOverride: async () => ({ organizationId: "org1", defaultDays: 30, minDays: 1, maxDays: 365, experiments: [] }),
  }),
  getAudit: () => ({ list: async (...args: unknown[]) => (state.audit.push(args), { items: [], nextCursor: null }) }),
  getExport: () => ({
    preview: async (input: unknown) => (state.exportPreviews.push(input), { rows: 2, maxRows: 2000000 }),
    start: async (input: unknown) => (
      state.exportStarted.push(input),
      { filename: "weather-traces.jsonl", rows: 2, lines: (async function* () { yield '{"a":1}'; yield '{"a":2}'; })() }
    ),
  }),
}));

const { GET: getRetention, PUT: putRetention } = await import("@/app/api/v1/organizations/[organizationId]/retention/route");
const { PUT: putExperimentRetention } = await import("@/app/api/v1/organizations/[organizationId]/experiments/[experimentId]/retention/route");
const { GET: getAudit } = await import("@/app/api/v1/organizations/[organizationId]/audit/route");
const { GET: getExport } = await import("@/app/api/v1/experiments/[experimentId]/export/route");

const orgCtx = { params: Promise.resolve({ organizationId: "org1" }) };
const expOrgCtx = { params: Promise.resolve({ organizationId: "org1", experimentId: "exp1" }) };
const expCtx = { params: Promise.resolve({ experimentId: "exp1" }) };
const put = (body: unknown) => new Request("http://x/", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  state.user = { id: "u1", email: "ana@example.com", name: "Ana", image: null };
  state.orgPermissions = [];
  state.experimentPermissions = [];
  state.audit = [];
  state.exportStarted = [];
  state.exportPreviews = [];
});

describe("retention routes", () => {
  it("need retention:manage to read or change", async () => {
    expect((await getRetention(new Request("http://x/"), orgCtx)).status).toBe(403);
    expect((await putRetention(put({ days: 10 }), orgCtx)).status).toBe(403);
    expect((await putExperimentRetention(put({ days: 10 }), expOrgCtx)).status).toBe(403);
    state.orgPermissions = ["audit:read", "org:manage"]; // otros permisos de org no bastan
    expect((await putRetention(put({ days: 10 }), orgCtx)).status).toBe(403);
  });

  it("need a session", async () => {
    state.user = null;
    expect((await getRetention(new Request("http://x/"), orgCtx)).status).toBe(401);
  });

  it("work with the permission, and reject a body that is not a number", async () => {
    state.orgPermissions = ["retention:manage"];
    expect((await getRetention(new Request("http://x/"), orgCtx)).status).toBe(200);
    const ok = await putRetention(put({ days: 10 }), orgCtx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).defaultDays).toBe(10);
    expect((await putRetention(put({ days: "ten" }), orgCtx)).status).toBe(400);
    expect((await putExperimentRetention(put({ days: null }), expOrgCtx)).status).toBe(200);
  });
});

describe("audit route", () => {
  it("needs audit:read, and retention:manage does not grant it", async () => {
    state.orgPermissions = ["retention:manage"];
    expect((await getAudit(new Request("http://x/"), orgCtx)).status).toBe(403);
    state.orgPermissions = ["audit:read"];
    expect((await getAudit(new Request("http://x/?action=trace.view&limit=10"), orgCtx)).status).toBe(200);
    expect(state.audit).toHaveLength(1);
  });

  it("rejects an unknown action, a bad date and a bad limit before querying", async () => {
    state.orgPermissions = ["audit:read"];
    expect((await getAudit(new Request("http://x/?action=drop.table"), orgCtx)).status).toBe(400);
    expect((await getAudit(new Request("http://x/?from=nope"), orgCtx)).status).toBe(400);
    expect((await getAudit(new Request("http://x/?limit=1.5"), orgCtx)).status).toBe(400);
    expect(state.audit).toHaveLength(0);
  });
});

describe("export route", () => {
  const url = "http://x/?kind=traces&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z";

  it("needs data:export on the experiment; experiment:read and retention:manage are not enough", async () => {
    state.experimentPermissions = ["experiment:read", "trace:read_technical"];
    state.orgPermissions = ["retention:manage", "audit:read"];
    expect((await getExport(new Request(url), expCtx)).status).toBe(403);
    expect(state.exportStarted).toHaveLength(0);
  });

  it("dryRun checks and counts without exporting, and needs the same permission", async () => {
    state.experimentPermissions = ["experiment:read"];
    expect((await getExport(new Request(`${url}&dryRun=1`), expCtx)).status).toBe(403);
    state.experimentPermissions = ["data:export"];
    const response = await getExport(new Request(`${url}&dryRun=1`), expCtx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: 2, maxRows: 2000000 });
    expect(state.exportPreviews).toHaveLength(1);
    expect(state.exportStarted).toHaveLength(0);
  });

  it("streams JSON Lines as a download and passes the actor and the service to the service", async () => {
    state.experimentPermissions = ["data:export"];
    const response = await getExport(new Request(url), expCtx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="weather-traces.jsonl"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe('{"a":1}\n{"a":2}\n');
    expect(state.exportStarted[0]).toMatchObject({ organizationId: "org1", scope: { experimentId: "exp1", serviceName: "weather" }, actor: { userId: "u1", email: "ana@example.com" }, kind: "traces" });
  });
});
