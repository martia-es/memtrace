/**
 * Asignación de identidad de tenant a un export OTLP (ADR-078).
 *
 * El gateway de ingesta no se fía de lo que el agente dice ser: quita `service.name` y `memtrace.experiment_id` de
 * cada Resource y pone los del experimento al que pertenece la API key. Así el tenant de un span lo decide la
 * plataforma, no quien lo envía.
 *
 * Protobuf se reescribe a nivel de cable (solo se tocan los campos de identidad del Resource; el resto de bytes se
 * copia tal cual), así que no hace falta una librería ni conocer el esquema completo de OTLP. JSON se reescribe
 * sobre el objeto.
 */

export const SERVICE_NAME_KEY = "service.name";
export const EXPERIMENT_ID_KEY = "memtrace.experiment_id";
const IDENTITY_KEYS = new Set([SERVICE_NAME_KEY, EXPERIMENT_ID_KEY]);

export interface TenantIdentity {
  experimentId: string;
  serviceName: string;
}

export interface RewriteResult {
  body: Uint8Array;
  /** Resources cuyo `service.name` declarado no coincidía con el del experimento (suele ser un agente mal configurado). */
  mismatchedResources: number;
}

export class MalformedOtlpError extends Error {}

// ---------- protobuf (wire format) ----------

interface Field {
  num: number;
  wire: number;
  /** campo completo (tag + valor) tal como venía */
  raw: Uint8Array;
  /** payload de un campo length-delimited (wire 2) */
  payload?: Uint8Array;
}

function readVarint(buf: Uint8Array, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (let i = offset; i < buf.length; i++) {
    const byte = buf[i]!;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, i + 1];
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new MalformedOtlpError("Invalid varint");
}

function writeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function parseFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    const [tag, afterTag] = readVarint(buf, pos);
    const num = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    pos = afterTag;
    if (num === 0) throw new MalformedOtlpError("Invalid field number");
    if (wire === 0) {
      pos = readVarint(buf, pos)[1];
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      if (len > BigInt(buf.length - afterLen)) throw new MalformedOtlpError("Length exceeds message");
      const end = afterLen + Number(len);
      fields.push({ num, wire, raw: buf.subarray(start, end), payload: buf.subarray(afterLen, end) });
      pos = end;
      continue;
    } else {
      throw new MalformedOtlpError("Unsupported wire type");
    }
    if (pos > buf.length) throw new MalformedOtlpError("Truncated message");
    fields.push({ num, wire, raw: buf.subarray(start, pos) });
  }
  return fields;
}

function concat(parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function lengthDelimited(num: number, payload: Uint8Array): Uint8Array {
  return concat([writeVarint((num << 3) | 2), writeVarint(payload.length), payload]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function stringKeyValue(key: string, value: string): Uint8Array {
  const anyValue = lengthDelimited(1, encoder.encode(value)); // AnyValue.string_value = 1
  const keyValue = concat([lengthDelimited(1, encoder.encode(key)), lengthDelimited(2, anyValue)]);
  return lengthDelimited(1, keyValue); // Resource.attributes = 1
}

function stringValueOf(keyValue: Uint8Array): { key: string; value: string | null } {
  let key = "";
  let value: string | null = null;
  for (const f of parseFields(keyValue)) {
    if (f.num === 1 && f.payload) key = decoder.decode(f.payload);
    if (f.num === 2 && f.payload) {
      const sv = parseFields(f.payload).find((a) => a.num === 1 && a.payload);
      if (sv?.payload) value = decoder.decode(sv.payload);
    }
  }
  return { key, value };
}

/** Quita la identidad declarada de un Resource y devuelve el resto de campos y el `service.name` que traía. */
function stripIdentity(resource: Uint8Array): { kept: Field[]; declaredServiceName: string | null } {
  let declaredServiceName: string | null = null;
  const kept: Field[] = [];
  for (const f of parseFields(resource)) {
    if (f.num === 1 && f.wire === 2 && f.payload) {
      const { key, value } = stringValueOf(f.payload);
      if (IDENTITY_KEYS.has(key)) {
        if (key === SERVICE_NAME_KEY) declaredServiceName = value ?? "";
        continue;
      }
    }
    kept.push(f);
  }
  return { kept, declaredServiceName };
}

function identityAttributes(identity: TenantIdentity): Uint8Array[] {
  return [stringKeyValue(SERVICE_NAME_KEY, identity.serviceName), stringKeyValue(EXPERIMENT_ID_KEY, identity.experimentId)];
}

function rewriteResourceSpans(message: Uint8Array, identity: TenantIdentity): { bytes: Uint8Array; mismatched: boolean } {
  const fields = parseFields(message);
  const resourceIdx = fields.flatMap((f, i) => (f.num === 1 && f.wire === 2 ? [i] : []));
  let declared: string | null = null;
  const stripped = new Map<number, Field[]>();
  for (const i of resourceIdx) {
    const result = stripIdentity(fields[i]!.payload!);
    stripped.set(i, result.kept);
    if (result.declaredServiceName !== null) declared = result.declaredServiceName;
  }

  // Un Resource repetido se fusiona en el cable: la identidad va solo en el último.
  const last = resourceIdx.length ? resourceIdx[resourceIdx.length - 1]! : -1;
  const out: Uint8Array[] = [];
  fields.forEach((f, i) => {
    if (!stripped.has(i)) return void out.push(f.raw);
    const parts: Array<Uint8Array> = stripped.get(i)!.map((k) => k.raw);
    if (i === last) parts.push(...identityAttributes(identity));
    out.push(lengthDelimited(1, concat(parts)));
  });
  if (last === -1) out.unshift(lengthDelimited(1, concat(identityAttributes(identity))));

  return { bytes: concat(out), mismatched: declared !== null && declared !== identity.serviceName };
}

export function rewriteProtobuf(body: Uint8Array, identity: TenantIdentity): RewriteResult {
  const out: Uint8Array[] = [];
  let mismatchedResources = 0;
  for (const f of parseFields(body)) {
    if (f.num === 1 && f.wire === 2 && f.payload) {
      const { bytes, mismatched } = rewriteResourceSpans(f.payload, identity);
      if (mismatched) mismatchedResources += 1;
      out.push(lengthDelimited(1, bytes));
    } else {
      out.push(f.raw);
    }
  }
  return { body: concat(out), mismatchedResources };
}

// ---------- JSON ----------

type JsonKeyValue = { key?: unknown; value?: { stringValue?: unknown } };

export function rewriteJson(body: Uint8Array, identity: TenantIdentity): RewriteResult {
  let doc: unknown;
  try {
    doc = JSON.parse(decoder.decode(body));
  } catch {
    throw new MalformedOtlpError("Invalid JSON");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new MalformedOtlpError("Expected a JSON object");
  // El JSON de protobuf admite también el nombre original del campo: rechazarlo evita una vía para esquivar la reescritura.
  if ("resource_spans" in doc) throw new MalformedOtlpError("Use resourceSpans (lowerCamelCase)");
  const resourceSpans = (doc as { resourceSpans?: unknown }).resourceSpans ?? [];
  if (!Array.isArray(resourceSpans)) throw new MalformedOtlpError("resourceSpans must be an array");

  let mismatchedResources = 0;
  for (const rs of resourceSpans) {
    if (typeof rs !== "object" || rs === null || Array.isArray(rs)) throw new MalformedOtlpError("Invalid resourceSpans entry");
    const entry = rs as { resource?: { attributes?: JsonKeyValue[] } };
    const resource = (entry.resource && typeof entry.resource === "object" ? entry.resource : (entry.resource = {})) as {
      attributes?: JsonKeyValue[];
    };
    const attributes = Array.isArray(resource.attributes) ? resource.attributes : [];
    let declared: string | null = null;
    const kept = attributes.filter((a) => {
      const key = typeof a?.key === "string" ? a.key : "";
      if (!IDENTITY_KEYS.has(key)) return true;
      if (key === SERVICE_NAME_KEY) declared = typeof a.value?.stringValue === "string" ? a.value.stringValue : "";
      return false;
    });
    kept.push(
      { key: SERVICE_NAME_KEY, value: { stringValue: identity.serviceName } },
      { key: EXPERIMENT_ID_KEY, value: { stringValue: identity.experimentId } },
    );
    resource.attributes = kept;
    if (declared !== null && declared !== identity.serviceName) mismatchedResources += 1;
  }
  (doc as { resourceSpans: unknown }).resourceSpans = resourceSpans;
  return { body: encoder.encode(JSON.stringify(doc)), mismatchedResources };
}

/** `content-type` → reescritor, o `null` si el gateway no sabe leer ese formato. */
export function rewriterFor(contentType: string | null): ((body: Uint8Array, identity: TenantIdentity) => RewriteResult) | null {
  const type = (contentType ?? "application/x-protobuf").split(";")[0]!.trim().toLowerCase();
  if (type === "application/x-protobuf") return rewriteProtobuf;
  if (type === "application/json") return rewriteJson;
  return null;
}
