import { z } from "zod";
import { ValidationError } from "@/domain/errors";
import type { ConversationCursor } from "@/domain/conversation";
import type { SpanCursor } from "@/domain/span-row";
import type { PageCursor } from "@/domain/trace";

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const boolean = z.enum(["true", "false"]).transform((value) => value === "true");
const nonEmpty = z.string().min(1).max(200);

export const timeRangeShape = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};

export const listTracesQuery = z.object({
  ...timeRangeShape,
  service: nonEmpty.optional(),
  status: z.enum(["ok", "error"]).optional(),
  hasErrors: boolean.optional(),
  minDurationMs: z.coerce.number().min(0).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().optional(), // el rango 1..200 lo impone el servicio
  cursor: z.string().max(512).optional(),
});

export const listSpansQuery = z.object({
  ...timeRangeShape,
  service: nonEmpty.optional(),
  kind: z.enum(["llm", "tool", "retriever", "agent", "chain", "embedding", "unknown"]).optional(),
  model: nonEmpty.optional(),
  status: z.enum(["ok", "error"]).optional(),
  text: z.string().min(1).max(200).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
});

export const listConversationsQuery = z.object({
  ...timeRangeShape,
  service: nonEmpty.optional(),
  hasErrors: boolean.optional(),
  limit: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
});

/** Turnos de una conversación: solo paginación */
export const turnsQuery = z.object({
  limit: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
});

/** Los ids de conversación son texto libre (los pone la aplicación): solo se acota su longitud */
export const conversationIdParam = z.string().min(1).max(200);

export const overviewQuery = z.object({ ...timeRangeShape, service: nonEmpty.optional() });

// ----- Custom metrics sobre spans definidos por el usuario (ADR-027) -----

export const stepKindsQuery = z.object({ ...timeRangeShape, service: nonEmpty.optional() });

/** `stepTypes` llega como lista separada por comas en la query string (no hay array nativo en GET). */
const stepTypesCsv = z
  .string()
  .min(1)
  .max(2000)
  .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean));

export const attributeValuesQuery = z.object({
  ...timeRangeShape,
  service: nonEmpty.optional(),
  stepTypes: stepTypesCsv,
  attribute: nonEmpty,
});

/** Claves de atributo vistas en los step types dados (ADR-030): alimenta "group by"/"filter by". */
export const attributeKeysQuery = z.object({
  ...timeRangeShape,
  service: nonEmpty.optional(),
  stepTypes: stepTypesCsv,
});

const customMetricFilterBody = z.object({ attribute: nonEmpty, values: z.array(z.string().min(1).max(500)).min(1).max(50) });

/** Cuerpo del builder de gráficos custom: enum cerrado a propósito, nunca SQL del usuario (ADR-027/030). */
export const customMetricDefinitionBody = z.object({
  chartType: z.enum(["bar", "pie", "line", "area", "number", "table"]),
  stepTypes: z.array(nonEmpty).min(1).max(20),
  metric: z.enum(["count", "avg_duration", "p50_duration", "p95_duration", "error_rate"]),
  groupByAttribute: nonEmpty.nullable().optional().default(null),
  filters: z.array(customMetricFilterBody).max(10).optional().default([]),
});

export const customMetricQueryBody = z.object({ ...timeRangeShape, ...customMetricDefinitionBody.shape });

export const saveCustomMetricBody = z.object({
  name: z.string().trim().min(1).max(200),
  definition: customMetricDefinitionBody,
});

/** Evaluación offline (ADR-028). */

export const createDatasetBody = z.object({
  name: z.string().trim().min(1).max(200),
});

const datasetItemBody = z.object({
  input: z.unknown(),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const addDatasetItemsBody = z.object({
  items: z.array(datasetItemBody).min(1).max(1000),
});

const scoreBody = z.object({
  name: z.string().min(1).max(200),
  value: z.string(),
  dataType: z.enum(["numeric", "boolean", "categorical"]),
  source: z.enum(["human", "code", "llm_judge"]),
  comment: z.string().nullable().optional().default(null),
});

const datasetRunItemBody = z.object({
  input: z.unknown(),
  expectedOutput: z.unknown().optional(),
  output: z.unknown().optional(),
  traceId: z.string().nullable().optional().default(null),
  error: z.string().nullable().optional().default(null),
  scores: z.array(scoreBody).default([]),
});

export const submitDatasetRunBody = z.object({
  name: z.string().trim().min(1).max(200),
  items: z.array(datasetRunItemBody).min(1).max(1000),
});
export const servicesQuery = z.object({ ...timeRangeShape });
export const usageQuery = z.object({ ...timeRangeShape });

export const traceIdParam = z
  .string()
  .regex(/^[0-9a-fA-F]{32}$/, "must be 32 hexadecimal characters")
  .transform((value) => value.toLowerCase());

/** Convierte los issues de zod en un ValidationError con un mensaje por campo. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, prefix?: string): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const name = issue.path.length > 0 ? issue.path.join(".") : (prefix ?? "value");
    fields[name] ??= issue.message;
  }
  throw new ValidationError("Invalid request", fields);
}

export function queryToObject(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries());
}

// ----- cursor opaco (base64url de {t, id}) -----

const cursorSchema = z.object({ t: z.number().int(), id: z.string().regex(/^[0-9a-f]{32}$/) });

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.startTimeUs, id: cursor.traceId })).toString("base64url");
}

const conversationCursorSchema = z.object({ t: z.number().int(), id: z.string().min(1).max(200) });

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.lastActivityUs, id: cursor.conversationId })).toString("base64url");
}

export function decodeConversationCursor(raw: string): ConversationCursor {
  try {
    const parsed = conversationCursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { lastActivityUs: parsed.t, conversationId: parsed.id };
  } catch {
    throw new ValidationError("Invalid request", { cursor: "invalid or expired cursor" });
  }
}

export function decodeCursor(raw: string): PageCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { startTimeUs: parsed.t, traceId: parsed.id };
  } catch {
    throw new ValidationError("Invalid request", { cursor: "invalid or expired cursor" });
  }
}

const spanCursorSchema = z.object({ t: z.number().int(), id: z.string().min(1).max(64) });

export function encodeSpanCursor(cursor: SpanCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.startTimeUs, id: cursor.spanId })).toString("base64url");
}

export function decodeSpanCursor(raw: string): SpanCursor {
  try {
    const parsed = spanCursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { startTimeUs: parsed.t, spanId: parsed.id };
  } catch {
    throw new ValidationError("Invalid request", { cursor: "invalid or expired cursor" });
  }
}
