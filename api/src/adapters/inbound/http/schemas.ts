import { z } from "zod";
import { ValidationError } from "@/domain/errors";
import type { ConversationCursor } from "@/domain/conversation";
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
export const servicesQuery = z.object({ ...timeRangeShape });

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
