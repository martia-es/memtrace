import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OtlpParseError, checkServiceNames, serviceNamesFromJson, serviceNamesFromProtobuf } from "@/domain/otlp-resource";

// Las peticiones de `tests/fixtures/otlp` las genera el codificador OTLP oficial de OpenTelemetry (Python), no un codificador propio.
const pb = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, `../fixtures/otlp/${name}.pb`)));
const json = (name: string) => readFileSync(resolve(__dirname, `../fixtures/otlp/${name}.json`), "utf8");

// codificador protobuf mínimo, solo para fabricar casos malformados o hostiles que el exportador oficial nunca produciría
const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n = Math.floor(n / 128);
  } while (n > 0);
  return out;
};
const ld = (field: number, bytes: number[]): number[] => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
const str = (s: string): number[] => [...new TextEncoder().encode(s)];
const attr = (key: string, value: string): number[] => ld(1, [...ld(1, str(key)), ...ld(2, ld(1, str(value)))]);
const request = (...resources: number[][]): Uint8Array => new Uint8Array(resources.flatMap((attrs) => ld(1, ld(1, attrs))));

describe("service names of an OTLP protobuf request", () => {
  it.each([
    ["agent-a", ["agent-a"]],
    ["unicode-agent", ["agente-ñandú-日本"]],
  ])("reads %s from a request made by the official encoder", (name, expected) => {
    expect(serviceNamesFromProtobuf(pb(name))).toEqual(expected);
  });

  it("returns one name per resource, in order", () => {
    expect(serviceNamesFromProtobuf(pb("a-and-b"))).toEqual(["agent-a", "agent-b"]);
  });

  it("gives null when the resource has no service.name, an empty one, or one that is not text", () => {
    expect(serviceNamesFromProtobuf(pb("no-service-name"))).toEqual([null]);
    expect(serviceNamesFromProtobuf(pb("empty-service-name"))).toEqual([""]);
    expect(serviceNamesFromProtobuf(pb("int-service-name"))).toEqual([null]);
  });

  it("an empty request has no resources", () => {
    expect(serviceNamesFromProtobuf(new Uint8Array(0))).toEqual([]);
  });

  it("refuses two service.name in one resource, because the store would keep one and this gate could have read the other", () => {
    expect(() => serviceNamesFromProtobuf(request([...attr("service.name", "mine"), ...attr("service.name", "victim")]))).toThrow(OtlpParseError);
  });

  it("reads the service.name wherever it sits among other attributes", () => {
    const names = serviceNamesFromProtobuf(request([...attr("a", "1"), ...attr("service.name", "x"), ...attr("z", "2")]));
    expect(names).toEqual(["x"]);
  });

  it.each([
    ["a truncated field", new Uint8Array([0x0a, 0x10, 0x01])],
    ["a varint that never ends", new Uint8Array([0x0a, ...Array(12).fill(0xff)])],
    ["a length bigger than the body", new Uint8Array([0x0a, 0xff, 0xff, 0xff, 0x7f, 0x00])],
    ["a group (unsupported wire type)", new Uint8Array([0x0b, 0x0c])],
    ["field number zero", new Uint8Array([0x00, 0x01])],
    ["plain text", new TextEncoder().encode("this is not protobuf at all")],
  ])("rejects %s without crashing", (_name, body) => {
    expect(() => serviceNamesFromProtobuf(body)).toThrow(OtlpParseError);
  });

  it("skips fields it does not need, whatever their type", () => {
    const body = new Uint8Array([
      ...varint(2 * 8 + 0), ...varint(300), // varint desconocido
      ...varint(3 * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8, // fixed64
      ...varint(4 * 8 + 5), 1, 2, 3, 4, // fixed32
      ...request([...attr("service.name", "ok")]),
    ]);
    expect(serviceNamesFromProtobuf(body)).toEqual(["ok"]);
  });
});

describe("service names of an OTLP JSON request", () => {
  it("matches the protobuf reading of the same request", () => {
    for (const name of ["agent-a", "a-and-b", "no-service-name", "empty-service-name", "int-service-name", "unicode-agent"]) {
      expect(serviceNamesFromJson(json(name))).toEqual(serviceNamesFromProtobuf(pb(name)));
    }
  });

  it("an empty object has no resources, and what is not an OTLP request at all is invalid", () => {
    expect(serviceNamesFromJson("{}")).toEqual([]);
    for (const bad of ["not json", "null", '{"resourceSpans": 3}', '{"resourceSpans": {}}']) {
      expect(() => serviceNamesFromJson(bad), bad).toThrow(OtlpParseError);
    }
  });

  it("refuses two service.name in one resource", () => {
    const body = JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "a" } }, { key: "service.name", value: { stringValue: "b" } }] } }] });
    expect(() => serviceNamesFromJson(body)).toThrow(OtlpParseError);
  });

  it("a resource without attributes has no name", () => {
    expect(serviceNamesFromJson('{"resourceSpans":[{}, {"resource":{}}]}')).toEqual([null, null]);
  });
});

describe("checkServiceNames", () => {
  it("accepts when every resource carries the key's service.name, or when there are none", () => {
    expect(checkServiceNames(["agent-a", "agent-a"], "agent-a")).toEqual({ ok: true, resources: 2 });
    expect(checkServiceNames([], "agent-a")).toEqual({ ok: true, resources: 0 });
  });

  it("refuses another service, and refuses the whole request if only one resource is another's", () => {
    expect(checkServiceNames(["agent-b"], "agent-a")).toEqual({ ok: false, reason: "mismatch", found: "agent-b" });
    expect(checkServiceNames(["agent-a", "agent-b"], "agent-a")).toEqual({ ok: false, reason: "mismatch", found: "agent-b" });
  });

  it("refuses a missing or empty name", () => {
    expect(checkServiceNames([null], "agent-a")).toMatchObject({ ok: false, reason: "missing" });
    expect(checkServiceNames([""], "agent-a")).toMatchObject({ ok: false, reason: "missing" });
  });

  it("is exact: case, whitespace and look-alike names do not match", () => {
    for (const other of ["Agent-A", "agent-a ", " agent-a", "agent-a​", "agent-а"]) {
      expect(checkServiceNames([other], "agent-a").ok).toBe(false);
    }
  });
});
