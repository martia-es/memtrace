import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGEST_RATE_LIMIT_PER_MINUTE = "3";
  process.env.INGEST_INVALID_KEY_LIMIT_PER_MINUTE = "2";
});

const resolveApiKey = vi.fn();
vi.mock("@/dependency-container", () => ({ getIdentity: () => ({ identityRepository: { resolveApiKey } }) }));

import { POST } from "@/app/api/v1/ingest/v1/traces/route";

const post = (headers: Record<string, string>) =>
  POST(new Request("http://x/api/v1/ingest/v1/traces", { method: "POST", body: JSON.stringify({ resourceSpans: [] }), headers: { "content-type": "application/json", ...headers } }));

beforeEach(() => {
  resolveApiKey.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ingest rate limits (ADR-081)", () => {
  it("refuses an experiment that exceeds its limit, with Retry-After, and keeps serving the others", async () => {
    resolveApiKey.mockImplementation(async (key: string) => ({ experimentId: key, serviceName: `svc-${key}`, createdByUserId: "u" }));
    const send = (key: string) => post({ authorization: `Bearer ${key}`, "x-forwarded-for": "10.0.0.1" });
    expect([1, 2, 3].map(async () => (await send("exp-a")).status)).toBeDefined();
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await send("exp-b")).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const refused = await send("exp-b");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await send("exp-c")).status).toBe(200); // otro experimento, otra cuenta
  });

  it("blocks an origin that keeps sending invalid keys before touching the database", async () => {
    resolveApiKey.mockResolvedValue(null);
    const send = (ip: string) => post({ authorization: "Bearer guess", "x-forwarded-for": `1.2.3.4, ${ip}` });
    expect((await send("203.0.113.9")).status).toBe(401);
    expect((await send("203.0.113.9")).status).toBe(401);
    const callsBefore = resolveApiKey.mock.calls.length;
    const blocked = await send("203.0.113.9");
    expect(blocked.status).toBe(429);
    expect(resolveApiKey.mock.calls.length).toBe(callsBefore); // ni una consulta más
    expect((await send("198.51.100.7")).status).toBe(401); // otro origen sigue pudiendo intentarlo
  });

  it("takes the origin from the last hop, which our proxy writes, not from what the client claims", async () => {
    resolveApiKey.mockResolvedValue(null);
    const spoof = (n: number) => post({ authorization: "Bearer guess", "x-forwarded-for": `9.9.9.${n}, 192.0.2.50` });
    const codes = [(await spoof(1)).status, (await spoof(2)).status, (await spoof(3)).status];
    expect(codes).toEqual([401, 401, 429]); // inventar IPs a la izquierda no evita el bloqueo
  });

  it("a valid key does not count against the origin's invalid-key budget", async () => {
    resolveApiKey.mockResolvedValue({ experimentId: "exp-ok", serviceName: "svc", createdByUserId: "u" });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post({ authorization: "Bearer good", "x-forwarded-for": "192.0.2.77" })).status);
    expect(statuses).toEqual([200, 200, 200]);
  });
});
