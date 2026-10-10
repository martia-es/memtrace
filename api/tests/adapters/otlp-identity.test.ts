import { describe, expect, it } from "vitest";
import { MalformedOtlpError, rewriteJson, rewriteProtobuf, rewriterFor } from "@/adapters/inbound/http/otlp-identity";

const IDENTITY = { experimentId: "11111111-1111-1111-1111-111111111111", serviceName: "acme-chatbot" };

// Export real generado con la librería oficial opentelemetry-proto (Python): dos ResourceSpans.
//  #1 service.name=chatbot, memtrace.experiment_id=spoofed, deployment.environment=pro, span con service.name=span-level
//  #2 sin service.name ni experiment_id, deployment.environment=pro
const REAL_EXPORT = Buffer.from(
  "CqwBCmEKGQoMc2VydmljZS5uYW1lEgkKB2NoYXRib3QKIwoWbWVtdHJhY2UuZXhwZXJpbWVudF9pZBIJCgdzcG9vZmVkCh8KFmRlcGxveW1lbnQuZW52aXJvbm1lbnQSBQoDcHJvEkcKAwoBdBJAChABAQEBAQEBAQEBAQEBAQEBEggCAgICAgICAioEY2hhdEocCgxzZXJ2aWNlLm5hbWUSDAoKc3Bhbi1sZXZlbApsCiEKHwoWZGVwbG95bWVudC5lbnZpcm9ubWVudBIFCgNwcm8SRwoDCgF0EkAKEAEBAQEBAQEBAQEBAQEBAQESCAICAgICAgICKgRjaGF0ShwKDHNlcnZpY2UubmFtZRIMCgpzcGFuLWxldmVs",
  "base64",
);

// Lector de cable independiente de la implementación, solo para comprobar el resultado.
function varint(buf: Uint8Array, at: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (let i = at; ; i++) {
    result += (buf[i]! & 0x7f) * mul;
    if (!(buf[i]! & 0x80)) return [result, i + 1];
    mul *= 128;
  }
}
function fields(buf: Uint8Array): Array<{ num: number; payload: Uint8Array }> {
  const out: Array<{ num: number; payload: Uint8Array }> = [];
  for (let at = 0; at < buf.length; ) {
    const [tag, a] = varint(buf, at);
    const wire = tag & 7;
    if (wire !== 2) throw new Error(`unexpected wire ${wire}`);
    const [len, b] = varint(buf, a);
    out.push({ num: tag >> 3, payload: buf.subarray(b, b + len) });
    at = b + len;
  }
  return out;
}
const text = (b: Uint8Array) => Buffer.from(b).toString("utf8");
function resourceAttrs(resourceSpans: Uint8Array): Array<[string, string]> {
  const resource = fields(resourceSpans).filter((f) => f.num === 1);
  return resource.flatMap((r) =>
    fields(r.payload)
      .filter((f) => f.num === 1)
      .map((kv): [string, string] => {
        const parts = fields(kv.payload);
        const key = text(parts.find((p) => p.num === 1)!.payload);
        const value = text(fields(parts.find((p) => p.num === 2)!.payload)[0]!.payload);
        return [key, value];
      }),
  );
}
const exportResources = (body: Uint8Array) => fields(body).filter((f) => f.num === 1).map((f) => f.payload);

describe("rewriteProtobuf", () => {
  const result = rewriteProtobuf(REAL_EXPORT, IDENTITY);
  const resources = exportResources(result.body);

  it("replaces a spoofed identity with the experiment's", () => {
    const attrs = resourceAttrs(resources[0]!);
    expect(attrs.filter(([k]) => k === "service.name")).toEqual([["service.name", "acme-chatbot"]]);
    expect(attrs.filter(([k]) => k === "memtrace.experiment_id")).toEqual([["memtrace.experiment_id", IDENTITY.experimentId]]);
    expect(text(result.body)).not.toContain("spoofed");
  });

  it("adds the identity to a resource that declared none", () => {
    const attrs = resourceAttrs(resources[1]!);
    expect(attrs).toContainEqual(["service.name", "acme-chatbot"]);
    expect(attrs).toContainEqual(["memtrace.experiment_id", IDENTITY.experimentId]);
  });

  it("keeps the other resource attributes and every span untouched", () => {
    for (const r of resources) expect(resourceAttrs(r)).toContainEqual(["deployment.environment", "pro"]);
    const scopeSpans = (i: number) => fields(resources[i]!).filter((f) => f.num === 2).map((f) => Buffer.from(f.payload).toString("hex"));
    const original = exportResources(REAL_EXPORT);
    expect(scopeSpans(0)).toEqual(fields(original[0]!).filter((f) => f.num === 2).map((f) => Buffer.from(f.payload).toString("hex")));
    // el service.name a nivel de span no es identidad de tenant y no se toca
    expect(text(result.body)).toContain("span-level");
  });

  it("counts only the resources that claimed another service.name", () => {
    expect(result.mismatchedResources).toBe(1);
    expect(rewriteProtobuf(REAL_EXPORT, { ...IDENTITY, serviceName: "chatbot" }).mismatchedResources).toBe(0);
  });

  it("is idempotent", () => {
    const again = rewriteProtobuf(result.body, IDENTITY);
    expect(Buffer.from(again.body).equals(Buffer.from(result.body))).toBe(true);
    expect(again.mismatchedResources).toBe(0);
  });

  it("passes an empty export through", () => {
    expect(rewriteProtobuf(new Uint8Array(), IDENTITY).body).toHaveLength(0);
  });

  it.each([
    ["truncated length", Uint8Array.from([0x0a, 0x7f, 0x01])],
    ["field number 0", Uint8Array.from([0x00, 0x01])],
    ["group wire type", Uint8Array.from([0x0b])],
    ["unterminated varint", Uint8Array.from([0x80, 0x80, 0x80])],
  ])("rejects malformed input: %s", (_name, bytes) => {
    expect(() => rewriteProtobuf(bytes, IDENTITY)).toThrow(MalformedOtlpError);
  });
});

describe("rewriteJson", () => {
  const run = (doc: unknown) => rewriteJson(new TextEncoder().encode(JSON.stringify(doc)), IDENTITY);
  const parse = (r: { body: Uint8Array }) => JSON.parse(text(r.body));

  it("replaces a spoofed identity and keeps the rest", () => {
    const result = run({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "victim" } },
              { key: "memtrace.experiment_id", value: { stringValue: "spoofed" } },
              { key: "deployment.environment", value: { stringValue: "pro" } },
            ],
          },
          scopeSpans: [{ spans: [{ name: "chat" }] }],
        },
      ],
    });
    const rs = parse(result).resourceSpans[0];
    expect(rs.resource.attributes).toEqual([
      { key: "deployment.environment", value: { stringValue: "pro" } },
      { key: "service.name", value: { stringValue: "acme-chatbot" } },
      { key: "memtrace.experiment_id", value: { stringValue: IDENTITY.experimentId } },
    ]);
    expect(rs.scopeSpans[0].spans[0].name).toBe("chat");
    expect(result.mismatchedResources).toBe(1);
  });

  it("creates the resource when it is missing", () => {
    const rs = parse(run({ resourceSpans: [{ scopeSpans: [] }] })).resourceSpans[0];
    expect(rs.resource.attributes.map((a: { key: string }) => a.key)).toEqual(["service.name", "memtrace.experiment_id"]);
  });

  it("rejects the snake_case alias that would bypass the rewrite", () => {
    expect(() => run({ resource_spans: [{ resource: { attributes: [] } }] })).toThrow(MalformedOtlpError);
  });

  it.each([["not json"], ["[]"], ['{"resourceSpans": 1}'], ['{"resourceSpans": [1]}']])("rejects malformed input: %s", (raw) => {
    expect(() => rewriteJson(new TextEncoder().encode(raw), IDENTITY)).toThrow(MalformedOtlpError);
  });
});

describe("rewriterFor", () => {
  it("picks the rewriter by content type", () => {
    expect(rewriterFor("application/x-protobuf")).toBe(rewriteProtobuf);
    expect(rewriterFor("application/json; charset=utf-8")).toBe(rewriteJson);
    expect(rewriterFor(null)).toBe(rewriteProtobuf);
    expect(rewriterFor("text/plain")).toBeNull();
  });
});
