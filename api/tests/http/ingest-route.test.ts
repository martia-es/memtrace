import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveApiKey = vi.fn();
vi.mock("@/dependency-container", () => ({ getIdentity: () => ({ identityRepository: { resolveApiKey } }) }));

import { POST } from "@/app/api/v1/ingest/v1/traces/route";

const ACCESS = { experimentId: "exp-1", serviceName: "acme-chatbot", createdByUserId: "u1" };
const json = (resourceAttrs: Array<{ key: string; value: { stringValue: string } }>) =>
  JSON.stringify({ resourceSpans: [{ resource: { attributes: resourceAttrs }, scopeSpans: [] }] });

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return POST(new Request("http://x/api/v1/ingest/v1/traces", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
}

let forwarded: Array<{ url: string; body: string; contentType: string | null }>;
beforeEach(() => {
  forwarded = [];
  resolveApiKey.mockReset().mockResolvedValue(ACCESS);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      forwarded.push({ url, body: Buffer.from(init.body as Uint8Array).toString("utf8"), contentType: new Headers(init.headers).get("content-type") });
      return new Response("{}", { status: 200 });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("ingest gateway", () => {
  it("rejects a missing or invalid API key without reaching the Collector", async () => {
    expect((await post("{}")).status).toBe(401);
    resolveApiKey.mockResolvedValue(null);
    expect((await post("{}", { authorization: "Bearer bad" })).status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  it("stamps the tenant identity of the key, whatever the agent claims", async () => {
    const res = await post(json([{ key: "service.name", value: { stringValue: "victim" } }]), { authorization: "Bearer good" });
    expect(res.status).toBe(200);
    const attrs = JSON.parse(forwarded[0]!.body).resourceSpans[0].resource.attributes;
    expect(attrs).toContainEqual({ key: "service.name", value: { stringValue: "acme-chatbot" } });
    expect(attrs).toContainEqual({ key: "memtrace.experiment_id", value: { stringValue: "exp-1" } });
    expect(JSON.stringify(attrs)).not.toContain("victim");
    expect(forwarded[0]!.url).toMatch(/\/v1\/traces$/);
    expect(forwarded[0]!.contentType).toBe("application/json");
  });

  it("logs a service.name mismatch but still ingests", async () => {
    await post(json([{ key: "service.name", value: { stringValue: "victim" } }]), { authorization: "Bearer good" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ingest.service_name_mismatch"));
  });

  it("decompresses gzip before rewriting", async () => {
    const res = await post(gzipSync(json([])), { authorization: "Bearer good", "content-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(forwarded[0]!.body).toContain("exp-1");
  });

  it("rejects unsupported content types and encodings", async () => {
    expect((await post("x", { authorization: "Bearer good", "content-type": "text/plain" })).status).toBe(415);
    expect((await post("x", { authorization: "Bearer good", "content-encoding": "br" })).status).toBe(415);
  });

  it("rejects malformed payloads and corrupt gzip with 400", async () => {
    expect((await post("not json", { authorization: "Bearer good" })).status).toBe(400);
    expect((await post("not gzip", { authorization: "Bearer good", "content-encoding": "gzip" })).status).toBe(400);
    expect(forwarded).toHaveLength(0);
  });

  it("rejects an oversized body with 413", async () => {
    const big = "x".repeat(10 * 1024 * 1024 + 1);
    expect((await post(big, { authorization: "Bearer good" })).status).toBe(413);
    expect(forwarded).toHaveLength(0);
  });
});
