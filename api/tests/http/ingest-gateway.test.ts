/**
 * Puerta de ingesta (ADR-013 pieza 9, ADR-081): con peticiones OTLP reales (las codifica el exportador oficial de OpenTelemetry)
 * comprueba que una API key solo escribe trazas de SU experimento y que lo que pasa llega intacto al Collector.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keys: Record<string, { experimentId: string; serviceName: string; createdByUserId: string }> = {
  "mtk_agent_a": { experimentId: "exp-a", serviceName: "agent-a", createdByUserId: "u1" },
};

vi.mock("@/dependency-container", () => ({
  getIdentity: () => ({ identityRepository: { resolveApiKey: async (key: string) => keys[key] ?? null } }),
}));

const { POST } = await import("@/app/api/v1/ingest/v1/traces/route");

const fixture = (name: string, ext: "pb" | "json" = "pb") => new Uint8Array(readFileSync(resolve(__dirname, `../fixtures/otlp/${name}.${ext}`)));
const PB = "application/x-protobuf";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}
let sent: Sent[];
let collectorStatus = 200;

beforeEach(() => {
  sent = [];
  collectorStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: Uint8Array }) => {
      sent.push({ url, headers: init.headers, body: init.body });
      return new Response('{"partialSuccess":{}}', { status: collectorStatus, headers: { "content-type": "application/json" } });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body: Uint8Array | string, headers: Record<string, string> = {}, key: string | null = "mtk_agent_a") =>
  POST(
    new Request("http://x/api/v1/ingest/v1/traces", {
      method: "POST",
      headers: { "content-type": PB, ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      body: body as BodyInit,
    }),
  );

describe("authentication", () => {
  it("needs a key, and a valid one", async () => {
    expect((await post(fixture("agent-a"), {}, null)).status).toBe(401);
    expect((await post(fixture("agent-a"), {}, "mtk_nope")).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

describe("a key writes only its own experiment's service.name", () => {
  it("forwards a matching request byte for byte", async () => {
    const body = fixture("agent-a");
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/\/v1\/traces$/);
    expect(Buffer.from(sent[0]!.body).equals(Buffer.from(body))).toBe(true);
    expect(sent[0]!.headers["content-type"]).toBe(PB);
    expect(sent[0]!.headers["content-encoding"]).toBeUndefined();
  });

  it("refuses another experiment's service.name and sends nothing to the Collector", async () => {
    const response = await post(fixture("a-and-b")); // un recurso es suyo y otro de agent-b
    expect(response.status).toBe(403);
    expect((await response.json()).detail).toContain('cannot write traces for "agent-b"');
    expect(sent).toHaveLength(0);
  });

  it.each(["no-service-name", "empty-service-name", "int-service-name"])("refuses %s", async (name) => {
    const response = await post(fixture(name));
    expect(response.status).toBe(403);
    expect((await response.json()).detail).toContain('service.name = "agent-a"');
    expect(sent).toHaveLength(0);
  });

  it("refuses a look-alike name", async () => {
    expect((await post(fixture("unicode-agent"))).status).toBe(403);
  });

  it("applies the same rule to OTLP/JSON", async () => {
    expect((await post(fixture("agent-a", "json"), { "content-type": "application/json" })).status).toBe(200);
    expect((await post(fixture("a-and-b", "json"), { "content-type": "application/json; charset=utf-8" })).status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it("lets an empty request through: it writes nothing", async () => {
    expect((await post(new Uint8Array(0))).status).toBe(200);
  });
});

describe("compression", () => {
  it("reads inside a gzip body but forwards the original bytes with their Content-Encoding", async () => {
    const zipped = gzipSync(fixture("agent-a"));
    const ok = await post(zipped, { "content-encoding": "gzip" });
    expect(ok.status).toBe(200);
    expect(Buffer.from(sent[0]!.body).equals(zipped)).toBe(true);
    expect(sent[0]!.headers["content-encoding"]).toBe("gzip");
  });

  it("applies the rule inside gzip too: a foreign service.name does not hide in a compressed body", async () => {
    const response = await post(gzipSync(fixture("a-and-b")), { "content-encoding": "gzip" });
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("refuses a body that is not gzip", async () => {
    expect((await post(fixture("agent-a"), { "content-encoding": "gzip" })).status).toBe(400);
  });

  it("refuses a decompression bomb instead of inflating it", async () => {
    const bomb = gzipSync(Buffer.alloc(70 * 1024 * 1024)); // 70 MB de ceros: unos 70 KB comprimidos
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const response = await post(bomb, { "content-encoding": "gzip" });
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("refuses an encoding it cannot read, since it could not check it", async () => {
    expect((await post(fixture("agent-a"), { "content-encoding": "br" })).status).toBe(415);
    expect((await post(fixture("agent-a"), { "content-encoding": "zstd" })).status).toBe(415);
    expect(sent).toHaveLength(0);
  });
});

describe("hostile or broken bodies", () => {
  it("answers 400 to something that is not OTLP, and never reaches the Collector", async () => {
    expect((await post(new TextEncoder().encode("hello"))).status).toBe(400);
    expect((await post("{not json", { "content-type": "application/json" })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("answers 413 to a body over the limit, using the declared size before reading it", async () => {
    const response = await post(fixture("agent-a"), { "content-length": String(17 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(sent).toHaveLength(0);
  });
});

describe("the Collector's answer", () => {
  it("is passed back to the agent, including a failure", async () => {
    collectorStatus = 503;
    expect((await post(fixture("agent-a"))).status).toBe(503);
  });
});
