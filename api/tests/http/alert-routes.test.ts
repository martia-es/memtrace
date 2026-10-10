/**
 * Rutas de alertas y presupuestos (ADR-086) con el servicio real y un repositorio en memoria: lo que se comprueba aquí es quién puede
 * qué y cómo responde la API a lo que está mal, no la lógica de dominio (que tiene sus propios tests).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertService } from "@/application/alert-service";
import { AuditService } from "@/application/audit-service";
import type { AuditEntryInput } from "@/domain/audit";
import { FakeAlertRepository } from "../support/fake-alert-repository";

const state = {
  user: { id: "u1", email: "ana@example.com", name: "Ana", image: null } as { id: string; email: string; name: string | null; image: string | null } | null,
  permissions: [] as string[],
  experiments: [] as Array<{ id: string; permissions: string[] }>,
  repo: new FakeAlertRepository(),
  audit: [] as AuditEntryInput[],
};

vi.mock("@/adapters/inbound/http/auth-context", () => ({
  requireUser: async () => state.user ?? new Response(JSON.stringify({ status: 401 }), { status: 401 }),
  requirePermission: async (_id: string, permission: string) => {
    if (!state.user) return new Response(JSON.stringify({ status: 401 }), { status: 401 });
    if (!state.permissions.includes(permission)) return new Response(JSON.stringify({ status: 403, detail: `Missing permission: ${permission}` }), { status: 403 });
    return { user: state.user, serviceName: "weather", organizationId: "org1", role: "technical", permissions: state.permissions };
  },
}));

vi.mock("@/dependency-container", () => ({
  getAlerts: () =>
    new AlertService(
      state.repo,
      new AuditService({ append: async (e) => void state.audit.push(e), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 }),
      async () => [],
      () => new Date("2026-10-10T12:00:00.000Z"),
    ),
  getIdentity: () => ({ identityRepository: { listExperimentsForUser: async () => state.experiments } }),
}));

const alerts = await import("@/app/api/v1/experiments/[experimentId]/alerts/route");
const one = await import("@/app/api/v1/experiments/[experimentId]/alerts/[ruleId]/route");
const events = await import("@/app/api/v1/experiments/[experimentId]/alerts/events/route");
const budget = await import("@/app/api/v1/experiments/[experimentId]/budget/route");
const open = await import("@/app/api/v1/alerts/open/route");
const notifications = await import("@/app/api/v1/notifications/route");
const markRead = await import("@/app/api/v1/notifications/read/route");

const exp = { params: Promise.resolve({ experimentId: "exp1" }) };
const rule = (id: string) => ({ params: Promise.resolve({ experimentId: "exp1", ruleId: id }) });
const send = (method: string, body?: unknown) => new Request("http://x/", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const valid = { name: "Errors up", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: ["ops@example.com"] };

beforeEach(() => {
  state.user = { id: "u1", email: "ana@example.com", name: "Ana", image: null };
  state.permissions = [];
  state.experiments = [];
  state.repo = new FakeAlertRepository();
  state.audit = [];
});

describe("reading alerts", () => {
  it("needs a session and experiment:read; a business profile (read only) can see them", async () => {
    state.user = null;
    expect((await alerts.GET(send("GET"), exp)).status).toBe(401);
    state.user = { id: "u1", email: "a@b.io", name: null, image: null };
    expect((await alerts.GET(send("GET"), exp)).status).toBe(403);
    state.permissions = ["experiment:read"];
    const response = await alerts.GET(send("GET"), exp);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rules: [], events: [], budget: null });
    expect((await events.GET(new Request("http://x/"), exp)).status).toBe(200);
    expect((await budget.GET(send("GET"), exp)).status).toBe(200);
  });

  it("rejects a history limit that is not a whole number", async () => {
    state.permissions = ["experiment:read"];
    expect((await events.GET(new Request("http://x/?limit=1.5"), exp)).status).toBe(400);
  });
});

describe("changing alerts needs alert:manage", () => {
  it("experiment:read is not enough for any change", async () => {
    state.permissions = ["experiment:read", "data:export", "retention:manage", "audit:read"];
    expect((await alerts.POST(send("POST", valid), exp)).status).toBe(403);
    expect((await one.PUT(send("PUT", valid), rule("r1"))).status).toBe(403);
    expect((await one.DELETE(send("DELETE"), rule("r1"))).status).toBe(403);
    expect((await budget.PUT(send("PUT", { monthlyUsd: 10 }), exp)).status).toBe(403);
    expect((await budget.DELETE(send("DELETE"), exp)).status).toBe(403);
    expect(state.repo.rules).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });

  it("creates, changes and deletes a rule, auditing each step with the organization of the experiment", async () => {
    state.permissions = ["experiment:read", "alert:manage"];
    const created = await alerts.POST(send("POST", valid), exp);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await one.PUT(send("PUT", { ...valid, threshold: 9 }), rule(id))).status).toBe(200);
    expect((await one.DELETE(send("DELETE"), rule(id))).status).toBe(200);
    expect(state.audit.map((e) => [e.action, e.organizationId, e.experimentId])).toEqual([
      ["alert.create", "org1", "exp1"],
      ["alert.update", "org1", "exp1"],
      ["alert.delete", "org1", "exp1"],
    ]);
  });

  it("answers 400 with the field that is wrong, and creates nothing", async () => {
    state.permissions = ["experiment:read", "alert:manage"];
    const response = await alerts.POST(send("POST", { ...valid, threshold: 500, recipients: ["nope"] }), exp);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(Object.keys(body.errors)).toEqual(expect.arrayContaining(["threshold", "recipients"]));
    expect(state.repo.rules).toHaveLength(0);
  });

  it("answers 400 to a body that is not JSON or not an object", async () => {
    state.permissions = ["alert:manage"];
    expect((await alerts.POST(new Request("http://x/", { method: "POST", body: "{nope" }), exp)).status).toBe(400);
    expect((await alerts.POST(send("POST", [1, 2]), exp)).status).toBe(400);
  });

  it("answers 404 for a rule that is not in the experiment", async () => {
    state.permissions = ["alert:manage"];
    expect((await one.PUT(send("PUT", valid), rule("nope"))).status).toBe(404);
    expect((await one.DELETE(send("DELETE"), rule("nope"))).status).toBe(404);
  });
});

describe("the budget", () => {
  it("is set, shown with the month's spend, and removed", async () => {
    state.permissions = ["experiment:read", "alert:manage"];
    await state.repo.upsertDailyCost("exp1", "2026-10-05", 20);
    const put = await budget.PUT(send("PUT", { monthlyUsd: 100, recipients: ["fin@example.com"] }), exp);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ month: "2026-10-01", spentUsd: 20, percent: 20, budget: { monthlyUsd: 100, warnPercent: 80 } });
    expect((await (await budget.GET(send("GET"), exp)).json()).budget).toMatchObject({ spentUsd: 20 });
    expect((await budget.DELETE(send("DELETE"), exp)).status).toBe(200);
    expect(await (await budget.GET(send("GET"), exp)).json()).toEqual({ budget: null });
    expect((await budget.DELETE(send("DELETE"), exp)).status).toBe(404);
  });

  it("answers 400 to an amount that is not positive", async () => {
    state.permissions = ["alert:manage"];
    const response = await budget.PUT(send("PUT", { monthlyUsd: 0 }), exp);
    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).errors)).toContain("monthlyUsd");
  });
});

describe("open alerts for the bell", () => {
  it("needs a session", async () => {
    state.user = null;
    expect((await open.GET()).status).toBe(401);
  });

  it("asks only about the experiments the person can read", async () => {
    state.experiments = [
      { id: "readable", permissions: ["experiment:read"] },
      { id: "manage-only", permissions: ["org:manage"] },
    ];
    const spy = vi.spyOn(state.repo, "listOpen");
    const response = await open.GET();
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(["readable"]);
    expect(await response.json()).toEqual({ items: [] });
  });
});

describe("notifications for the bell", () => {
  const note = (id: string, experimentId: string, at: string) => ({
    id, kind: "fired" as const, at, experimentId, experimentName: "Weather", ruleId: "r1", ruleName: "Too slow", metric: "latency_p95" as const, comparator: "above" as const,
    value: 2807, threshold: 5, budgetUsd: null, warnPercent: null,
  });
  type Feed = { items: Array<{ id: string; read: boolean }>; unread: number };

  it("needs a session, for reading and for marking as read", async () => {
    state.user = null;
    expect((await notifications.GET()).status).toBe(401);
    expect((await markRead.POST()).status).toBe(401);
  });

  it("only looks at the agents the person can read, over the last 14 days", async () => {
    state.experiments = [
      { id: "readable", permissions: ["experiment:read"] },
      { id: "manage-only", permissions: ["org:manage"] },
    ];
    await notifications.GET();
    expect(state.repo.notificationCalls[0]!.experimentIds).toEqual(["readable"]);
    expect(state.repo.notificationCalls[0]!.since.toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });

  it("marks as unread whatever is newer than the person's mark, and counts them", async () => {
    state.experiments = [{ id: "e1", permissions: ["experiment:read"] }];
    state.repo.notificationItems = [note("new", "e1", "2026-10-10T11:00:00.000Z"), note("old", "e1", "2026-10-10T09:00:00.000Z")];
    state.repo.readAt.set("u1", new Date("2026-10-10T10:00:00.000Z"));
    const body = (await (await notifications.GET()).json()) as Feed;
    expect(body.items.map((i) => [i.id, i.read])).toEqual([["new", false], ["old", true]]);
    expect(body.unread).toBe(1);
  });

  it("counts everything as unread until the person marks something as read", async () => {
    state.experiments = [{ id: "e1", permissions: ["experiment:read"] }];
    state.repo.notificationItems = [note("a", "e1", "2026-10-10T11:00:00.000Z")];
    expect(((await (await notifications.GET()).json()) as Feed).unread).toBe(1);
  });

  it("marking as read keeps the moment for that person only, and the unread count drops to zero", async () => {
    state.experiments = [{ id: "e1", permissions: ["experiment:read"] }];
    state.repo.notificationItems = [note("a", "e1", "2026-10-10T11:00:00.000Z")];
    expect((await markRead.POST()).status).toBe(204);
    expect([...state.repo.readAt.keys()]).toEqual(["u1"]);
    expect(((await (await notifications.GET()).json()) as Feed).unread).toBe(0);
  });
});
