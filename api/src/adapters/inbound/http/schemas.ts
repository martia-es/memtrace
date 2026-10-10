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

export const lowRatedQuery = z.object({ ...timeRangeShape });

const idList = z.string().min(1).max(8000).transform((v) => v.split(",").filter(Boolean)).pipe(z.array(z.string().max(200)).min(1).max(200));
export const ratingsQuery = z
  .object({ traceIds: idList.optional(), conversationIds: idList.optional() })
  .refine((q) => Boolean(q.traceIds) !== Boolean(q.conversationIds), { message: "Pass exactly one of traceIds or conversationIds" });

/** Filtro por prompt del registro (ADR-068): el nombre y, opcionalmente, una versión concreta. */
const promptFilterShape = {
  promptName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/).optional(),
  promptVersion: z.coerce.number().int().min(1).optional(),
};

export const listTracesQuery = z.object({
  ...timeRangeShape,
  status: z.enum(["ok", "error"]).optional(),
  hasErrors: boolean.optional(),
  minDurationMs: z.coerce.number().min(0).optional(),
  text: z.string().min(1).max(200).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  revision: z.string().regex(/^[0-9a-fA-F]{7,64}$/).optional(),
  ...promptFilterShape,
  limit: z.coerce.number().int().optional(), // el rango 1..200 lo impone el servicio
  cursor: z.string().max(512).optional(),
});

export const listSpansQuery = z.object({
  ...timeRangeShape,
  kind: z.enum(["llm", "tool", "retriever", "agent", "chain", "embedding", "unknown"]).optional(),
  model: nonEmpty.optional(),
  status: z.enum(["ok", "error"]).optional(),
  text: z.string().min(1).max(200).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  revision: z.string().regex(/^[0-9a-fA-F]{7,64}$/).optional(),
  ...promptFilterShape,
  limit: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
});

export const listConversationsQuery = z.object({
  ...timeRangeShape,
  hasErrors: boolean.optional(),
  text: z.string().min(1).max(200).optional(),
  revision: z.string().regex(/^[0-9a-fA-F]{7,64}$/).optional(),
  ...promptFilterShape,
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

export const errorOverviewQuery = z.object({ ...timeRangeShape });
export const overviewQuery = z.object({ ...timeRangeShape });

// ----- Custom metrics sobre spans definidos por el usuario (ADR-027) -----

export const stepKindsQuery = z.object({ ...timeRangeShape });

/** `stepTypes` llega como lista separada por comas en la query string (no hay array nativo en GET). */
const stepTypesCsv = z
  .string()
  .min(1)
  .max(2000)
  .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean));

export const attributeValuesQuery = z.object({
  ...timeRangeShape,
  stepTypes: stepTypesCsv,
  attribute: nonEmpty,
});

/** Claves de atributo vistas en los step types dados (ADR-030): alimenta "group by"/"filter by". */
export const attributeKeysQuery = z.object({
  ...timeRangeShape,
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

/** Informes guardados (ADR-033): nombre + grid de charts ya guardados. */
export const createMetricReportBody = z.object({ name: z.string().trim().min(1).max(200) });
export const renameMetricReportBody = z.object({ name: z.string().trim().min(1).max(200) });

const metricReportChartBody = z.object({
  customMetricId: z.string().uuid(),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(50),
});
export const setMetricReportChartsBody = z.object({ charts: z.array(metricReportChartBody).max(50) });

export const sendMetricReportEmailBody = z.object({ toEmails: z.array(z.string().email()).min(1).max(20) });

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

/** Promoción de trazas a items de dataset: una llamada = una versión (ADR-038). */
export const promoteTracesBody = z.object({
  items: z
    .array(z.object({ traceId: z.string().min(1), input: z.unknown().optional(), expectedOutput: z.unknown().optional(), fromConfigId: z.string().min(1).optional(), useObservedOutput: z.boolean().optional(), queueId: z.string().uuid().optional() }))
    .min(1)
    .max(100),
});

export const updateDatasetItemBody = z.object({
  input: z.unknown().optional(),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Una sesión de edición del dashboard: altas, ediciones y bajas que se publican juntas como UNA versión (ADR-041). */
export const commitDatasetChangesBody = z
  .object({
    add: z.array(datasetItemBody).max(1000).default([]),
    update: z.array(updateDatasetItemBody.extend({ id: z.string().min(1) })).max(1000).default([]),
    remove: z.array(z.string().min(1)).max(1000).default([]),
  })
  .refine((b) => b.add.length + b.update.length + b.remove.length > 0, { message: "at least one change is required" });

const scoreBody = z.object({
  name: z.string().min(1).max(200),
  value: z.string(),
  dataType: z.enum(["numeric", "boolean", "categorical"]),
  source: z.enum(["human", "code", "llm_judge"]),
  comment: z.string().nullable().optional().default(null),
  judgeModel: z.string().max(200).nullable().optional().default(null),
  judgePromptHash: z.string().max(64).nullable().optional().default(null),
});

const datasetRunItemBody = z.object({
  /** Posición del item en el run (ADR-034): permite subir los items en cuanto terminan, en cualquier orden. */
  itemIndex: z.number().int().min(0).optional(),
  input: z.unknown(),
  expectedOutput: z.unknown().optional(),
  output: z.unknown().optional(),
  traceId: z.string().nullable().optional().default(null),
  error: z.string().nullable().optional().default(null),
  scores: z.array(scoreBody).default([]),
});

/** Crea un run (ADR-034). `datasetVersion` es obligatoria: el run declara siempre de qué versión salieron sus items.
 * `complete: false` lo deja `running` para seguir añadiendo lotes (y entonces `items` puede ir vacío). */
export const submitDatasetRunBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    datasetVersion: z.string().trim().min(1),
    items: z.array(datasetRunItemBody).max(1000),
    complete: z.boolean().default(true),
    /** commit del código que se evalúa (ADR-065); el SDK lo manda si lo encuentra */
    revision: z.object({ sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/), dirty: z.boolean().nullable().default(null) }).nullable().default(null),
  })
  .refine((b) => b.items.length > 0 || !b.complete, { message: "items must not be empty for a completed run", path: ["items"] });

/** Añade un lote a un run `running`. Cada item lleva su `itemIndex`; `startIndex` (posición del primer item
 * del lote) solo se usa para los items que no lo traen. */
export const appendDatasetRunItemsBody = z.object({
  startIndex: z.number().int().min(0).default(0),
  items: z.array(datasetRunItemBody).max(1000),
  complete: z.boolean().default(false),
});
export const servicesQuery = z.object({ ...timeRangeShape });
export const revisionsQuery = z.object({ ...timeRangeShape });
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

/** Score configs (ADR-036). Aquí solo se valida la forma del JSON; las reglas por `dataType` e invariantes viven en el dominio. */
const scoreConfigCategoryBody = z.object({ label: z.string().max(200), value: z.number().nullable().optional().default(null) });

export const createScoreConfigBody = z.object({
  name: z.string().max(200),
  dataType: z.enum(["numeric", "boolean", "categorical"]),
  minValue: z.number().nullable().optional().default(null),
  maxValue: z.number().nullable().optional().default(null),
  categories: z.array(scoreConfigCategoryBody).max(100).nullable().optional().default(null),
  targetPassRate: z.number().nullable().optional().default(null),
  description: z.string().max(2000).nullable().optional().default(null),
});

export const updateScoreConfigBody = z.object({
  description: z.string().max(2000).nullable().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  categories: z.array(scoreConfigCategoryBody).max(100).optional(),
  targetPassRate: z.number().nullable().optional(),
});

/** Anotaciones (ADR-037). `value` acepta número/booleano además de string; el dominio lo valida contra la config. */
export const saveAnnotationBody = z.object({
  configId: z.string().uuid(),
  value: z.union([z.string().max(2000), z.number(), z.boolean()]),
  comment: z.string().max(5000).nullable().optional(),
  spanId: z.string().regex(/^[0-9a-f]{16}$/i, "Must be a 16-character hex span id").nullable().optional(),
});

const spanIdField = z.string().regex(/^[0-9a-f]{16}$/i, "Must be a 16-character hex span id");

/** Voto de feedback de usuario final (ADR-062). `rating` se valida en el dominio para dar un 422 claro. */
export const submitFeedbackBody = z.object({
  rating: z.number().int(),
  comment: z.string().max(5000).nullable().optional(),
  spanId: spanIdField.nullable().optional(),
  endUserId: z.string().max(200).nullable().optional(),
  externalMessageId: z.string().max(200).nullable().optional(),
});

export const retractFeedbackQuery = z.object({
  spanId: spanIdField.optional(),
  endUserId: z.string().max(200).optional(),
});

export const feedbackOverviewQuery = z.object({ ...timeRangeShape });

export const retractAnnotationQuery = z.object({
  spanId: z.string().regex(/^[0-9a-f]{16}$/i).optional(),
  annotatorId: z.string().uuid().optional(),
});

/** Colas de anotación (ADR-039). Aquí solo la forma del JSON; las reglas (rúbrica, límites) viven en el dominio/servicio. */
const queueRubricEntryBody = z.object({ configId: z.string().uuid(), required: z.boolean().optional().default(true) });

export const createAnnotationQueueBody = z.object({
  name: z.string().max(200),
  instructions: z.string().max(5000).nullable().optional().default(null),
  requiredAnnotations: z.number().int().optional().default(1),
  reviewerIds: z.array(z.string().uuid()).max(100),
  rubric: z.array(queueRubricEntryBody).max(50),
});

export const updateAnnotationQueueBody = z.object({
  name: z.string().max(200).optional(),
  instructions: z.string().max(5000).nullable().optional(),
  requiredAnnotations: z.number().int().optional(),
  reviewerIds: z.array(z.string().uuid()).max(100).optional(),
  rubric: z.array(queueRubricEntryBody).max(50).optional(),
  archived: z.boolean().optional(),
});

/** Muestreo aleatorio al poblar una cola (ADR-040): `size` elementos al azar; sin `seed` la genera el servidor y la devuelve. */
const queueSample = z.strictObject({ size: z.number().int().min(1).max(500), seed: z.string().min(1).max(64).optional() });

/** Exactamente una forma: ids explícitos, instantánea de un filtro de trazas, un run (entero o muestreado) o items de un run (ADR-039). */
export const addQueueItemsBody = z.union([
  z.strictObject({ traceIds: z.array(z.string().min(1).max(64)).max(500) }),
  z.strictObject({
    fromFilter: z
      .strictObject({
        from: isoDate.optional(),
        to: isoDate.optional(),
        status: z.enum(["ok", "error"]).optional(),
        hasErrors: z.boolean().optional(),
        minDurationMs: z.number().min(0).optional(),
        conversationId: z.string().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        sample: queueSample.optional(),
      })
      .refine((f) => (f.limit === undefined) !== (f.sample === undefined), { message: "exactly one of limit or sample is required" }),
  }),
  z.strictObject({ fromRun: z.strictObject({ datasetRunId: z.string().uuid(), sample: queueSample.optional() }) }),
  z.strictObject({ runItems: z.array(z.strictObject({ datasetRunId: z.string().uuid(), itemIndex: z.number().int().min(0) })).max(500) }),
]);

export const completeQueueItemBody = z.object({
  labels: z.array(z.object({ configId: z.string().uuid(), value: z.union([z.string().max(2000), z.number(), z.boolean()]), comment: z.string().max(5000).nullable().optional() })).max(50),
});

export const listQueueItemsQuery = z.object({
  status: z.enum(["pending", "completed", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const queueResultsQuery = z.object({
  status: z.enum(["pending", "completed", "skipped"]).optional(),
  onlyDisagreements: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const resolveQueueItemBody = z.strictObject({
  value: z.union([z.string().max(500), z.number(), z.boolean()]),
  expectedOutput: z.string().max(20000).nullable().optional(),
});

/** Alcance del acuerdo juez-humano (ADR-040): exactamente un run o una cola, nunca el experimento entero. */
export const judgeHumanAgreementQuery = z
  .object({
    datasetRunId: z.string().uuid().optional(),
    queueId: z.string().uuid().optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .refine((q) => (q.datasetRunId === undefined) !== (q.queueId === undefined), { message: "exactly one of datasetRunId or queueId is required" });

export const interAnnotatorAgreementQuery = z.object({
  queueId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
});
