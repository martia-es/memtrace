/**
 * Lector mínimo de una petición OTLP/HTTP de trazas (ADR-085): solo saca el `service.name` de cada `ResourceSpans`, sin
 * decodificar un solo span. En protobuf recorre unos pocos campos de cabecera y salta el resto por su longitud, así que el coste
 * es una fracción de lo que cuesta copiar el cuerpo.
 *
 * Esquema (opentelemetry-proto, estable):
 *   ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1 }
 *   ResourceSpans { Resource resource = 1; ... }
 *   Resource { repeated KeyValue attributes = 1; ... }
 *   KeyValue { string key = 1; AnyValue value = 2 }
 *   AnyValue { string string_value = 1; ... }
 */

export class OtlpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtlpParseError";
  }
}

/** El `service.name` de un `ResourceSpans`; `null` si el recurso no lo trae como texto. */
export type ServiceName = string | null;

const SERVICE_NAME = "service.name";
const MAX_RESOURCES = 65_536;

interface Field {
  number: number;
  wireType: number;
  /** contenido de un campo de longitud variable (wire type 2); vacío en el resto */
  bytes: Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (pos + i >= buf.length) throw new OtlpParseError("Truncated varint");
    const byte = buf[pos + i]!;
    // los números de campo y las longitudes caben de sobra en 2^53; más bits solo importan en valores que se saltan
    if (shift < 49) result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, next: pos + i + 1 };
    shift += 7;
  }
  throw new OtlpParseError("Varint too long");
}

/** Recorre los campos de un mensaje protobuf. Solo los de longitud variable entregan contenido. */
function* fields(buf: Uint8Array): Generator<Field> {
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.next;
    const number = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (number === 0) throw new OtlpParseError("Invalid field number");
    if (wireType === 0) {
      pos = readVarint(buf, pos).next;
      yield { number, wireType, bytes: EMPTY };
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) throw new OtlpParseError("Truncated fixed64");
      pos += 8;
      yield { number, wireType, bytes: EMPTY };
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) throw new OtlpParseError("Truncated fixed32");
      pos += 4;
      yield { number, wireType, bytes: EMPTY };
    } else if (wireType === 2) {
      const len = readVarint(buf, pos);
      pos = len.next;
      if (pos + len.value > buf.length) throw new OtlpParseError("Truncated field");
      yield { number, wireType, bytes: buf.subarray(pos, pos + len.value) };
      pos += len.value;
    } else {
      throw new OtlpParseError(`Unsupported wire type ${wireType}`);
    }
  }
}

const EMPTY = new Uint8Array(0);
const decoder = new TextDecoder("utf-8", { fatal: false });

function stringValueOf(anyValue: Uint8Array): string | null {
  for (const f of fields(anyValue)) if (f.number === 1 && f.wireType === 2) return decoder.decode(f.bytes);
  return null;
}

function serviceNameOfResource(resource: Uint8Array): ServiceName {
  let found: ServiceName = null;
  let seen = false;
  for (const attribute of fields(resource)) {
    if (attribute.number !== 1 || attribute.wireType !== 2) continue;
    let key: string | null = null;
    let value: Uint8Array | null = null;
    for (const kv of fields(attribute.bytes)) {
      if (kv.number === 1 && kv.wireType === 2) key = decoder.decode(kv.bytes);
      else if (kv.number === 2 && kv.wireType === 2) value = kv.bytes;
    }
    if (key === SERVICE_NAME) {
      // dos `service.name` en el mismo recurso: el almacén se queda con uno y esta puerta podría haber mirado el otro
      if (seen) throw new OtlpParseError("Duplicate service.name in a resource");
      seen = true;
      if (value) found = stringValueOf(value);
    }
  }
  return found;
}

/** `service.name` de cada `ResourceSpans` de una petición protobuf, en orden. */
export function serviceNamesFromProtobuf(body: Uint8Array): ServiceName[] {
  const names: ServiceName[] = [];
  for (const resourceSpans of fields(body)) {
    if (resourceSpans.number !== 1 || resourceSpans.wireType !== 2) continue;
    let name: ServiceName = null;
    for (const f of fields(resourceSpans.bytes)) {
      if (f.number === 1 && f.wireType === 2) name = serviceNameOfResource(f.bytes);
    }
    names.push(name);
  }
  return names;
}

interface JsonKeyValue {
  key?: unknown;
  value?: { stringValue?: unknown };
}

/** Lo mismo para OTLP/JSON (`resourceSpans[].resource.attributes[]`). */
export function serviceNamesFromJson(text: string): ServiceName[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OtlpParseError("Invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new OtlpParseError("Invalid OTLP request");
  const resourceSpans = (parsed as { resourceSpans?: unknown }).resourceSpans;
  if (resourceSpans === undefined) return [];
  if (!Array.isArray(resourceSpans) || resourceSpans.length > MAX_RESOURCES) throw new OtlpParseError("Invalid resourceSpans");
  return resourceSpans.map((rs): ServiceName => {
    const attributes = (rs as { resource?: { attributes?: unknown } } | null)?.resource?.attributes;
    if (!Array.isArray(attributes)) return null;
    let name: ServiceName = null;
    let seen = false;
    for (const a of attributes as JsonKeyValue[]) {
      if (a?.key !== SERVICE_NAME) continue;
      if (seen) throw new OtlpParseError("Duplicate service.name in a resource");
      seen = true;
      if (typeof a.value?.stringValue === "string") name = a.value.stringValue;
    }
    return name;
  });
}

export type IngestVerdict =
  | { ok: true; resources: number }
  | { ok: false; reason: "missing" | "mismatch"; found: ServiceName };

/**
 * Decide si una petición puede escribir en el experimento de la key: cada `ResourceSpans` debe traer exactamente el
 * `service.name` del experimento. Una petición sin recursos no escribe nada y se deja pasar.
 */
export function checkServiceNames(names: ServiceName[], expected: string): IngestVerdict {
  for (const name of names) {
    if (name === null || name === "") return { ok: false, reason: "missing", found: name };
    if (name !== expected) return { ok: false, reason: "mismatch", found: name };
  }
  return { ok: true, resources: names.length };
}
