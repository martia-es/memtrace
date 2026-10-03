/** Promoción de una traza anotada a item de dataset (ADR-038): extracción del contenido y resolución del `expectedOutput`. */
import type { Annotation } from "@/domain/annotation";
import { extractContent } from "@/domain/genai";
import type { Span } from "@/domain/span";

export type PromotionSkipReason = "already_promoted" | "no_content" | "not_found" | "ambiguous_label" | "unsupported_label";

/** Entrada y salida completas de la traza (no la vista previa de 240 caracteres del listado). `output` es null si no se capturó. */
export interface TraceContent {
  input: unknown;
  output: unknown | null;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim() !== "";
}

/**
 * Misma regla que la vista previa del listado de trazas: la entrada es la del primer span que la tiene;
 * la salida, la del último en terminar. Devuelve null si ningún span capturó entrada (contenido desactivado,
 * ADR-004, o span de `eval.item`, que no registra contenido): nunca se promueve un fixture vacío.
 * Un valor con `[REDACTED]` dentro (ADR-021) sigue siendo contenido; la persona lo revisa en el preview.
 */
export function extractTraceContent(spans: Span[]): TraceContent | null {
  const withContent = spans.map((span) => ({ span, content: extractContent(span.attributes) })).filter((s) => s.content !== null);
  const byStart = [...withContent].sort((a, b) => a.span.startTimeUs - b.span.startTimeUs);
  const first = byStart.find((s) => isPresent(s.content!.input ?? s.content!.inputMessages));
  if (!first) return null;
  const endOf = (s: Span) => s.startTimeUs + s.durationMs * 1000;
  const last = [...withContent].sort((a, b) => endOf(b.span) - endOf(a.span)).find((s) => isPresent(s.content!.output ?? s.content!.outputMessages));
  return {
    input: first.content!.input ?? first.content!.inputMessages,
    output: last ? (last.content!.output ?? last.content!.outputMessages) : null,
  };
}

export type ExpectedOutputResolution = { ok: true; value: unknown } | { ok: false; reason: Extract<PromotionSkipReason, "ambiguous_label" | "unsupported_label"> };

/**
 * Orden de prioridad (ADR-038): 1) `expectedOutput` explícito; 2) etiqueta categórica de `fromConfigId` si todas las
 * anotaciones vigentes de la traza para esa config coinciden; 3) null. Un veredicto numérico o booleano no es una
 * respuesta de referencia, así que una config de esos tipos se rechaza en vez de convertirse en `expectedOutput`.
 */
export function resolveExpectedOutput(input: { expectedOutput?: unknown; fromConfigId?: string; annotations: Annotation[] }): ExpectedOutputResolution {
  if (input.expectedOutput !== undefined) return { ok: true, value: input.expectedOutput };
  if (!input.fromConfigId) return { ok: true, value: null };
  const labels = input.annotations.filter((a) => a.configId === input.fromConfigId && a.spanId === null && !a.datasetRunId);
  if (labels.length === 0) return { ok: true, value: null };
  if (labels.some((a) => a.dataType !== "categorical")) return { ok: false, reason: "unsupported_label" };
  if (new Set(labels.map((a) => a.value)).size > 1) return { ok: false, reason: "ambiguous_label" };
  return { ok: true, value: labels[0]!.value };
}

export interface PromotedItemDraft {
  traceId: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: { promotedFrom: PromotedFrom };
}

/** Clave reservada de `metadata` (ADR-038): copia puntual, no se sincroniza con la traza ni con las anotaciones. */
export interface PromotedFrom {
  traceId: string;
  promotedBy: string;
  promotedAt: string;
  observedOutput: unknown | null;
  annotations: Array<{ config: string; value: string; annotator: string }>;
}

export function buildPromotedItem(args: {
  traceId: string;
  content: TraceContent;
  expectedOutput: unknown;
  annotations: Annotation[];
  promotedBy: string;
  promotedAt: Date;
}): PromotedItemDraft {
  return {
    traceId: args.traceId,
    input: args.content.input,
    expectedOutput: args.expectedOutput,
    metadata: {
      promotedFrom: {
        traceId: args.traceId,
        promotedBy: args.promotedBy,
        promotedAt: args.promotedAt.toISOString(),
        observedOutput: args.content.output,
        annotations: args.annotations
          .filter((a) => a.spanId === null && !a.datasetRunId)
          .map((a) => ({ config: a.configName, value: a.value, annotator: a.annotatorId })),
      },
    },
  };
}
