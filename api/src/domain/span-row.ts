import { costOf, type PricingCatalog } from "./pricing";
import type { StatusCode } from "./span";
import { lastOf, parseMessages } from "./transcript";

/** Fila de un span en el listado plano: sin árbol, con una vista previa de su entrada y salida. */
export interface SpanRow {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  conversationId: string | null;
  name: string;
  /** llm | tool | retriever | agent | chain | embedding | unknown */
  kind: string;
  serviceName: string;
  startTimeUs: number;
  durationMs: number;
  status: StatusCode;
  model: string | null;
  /** null si el span no es una llamada a un LLM */
  totalTokens: number | null;
  /** null si el span no es una llamada a un LLM, o no hay precio conocido para su modelo (ADR-025) */
  costUsd: number | null;
  input: string | null;
  output: string | null;
}

/** Posición en el listado de spans (keyset). */
export interface SpanCursor {
  startTimeUs: number;
  spanId: string;
}

/** Contenido crudo tal y como lo guarda el almacén. `*Raw` puede ser JSON de mensajes, JSON de una herramienta o texto. */
export interface SpanRecord extends Omit<SpanRow, "input" | "output" | "costUsd"> {
  inputRaw: string | null;
  outputRaw: string | null;
  /** el span guarda mensajes de chat (`gen_ai.*.messages`), no un valor suelto */
  chat: boolean;
  /** tokens de entrada/salida por separado: el coste puede tener precio distinto para cada uno (ADR-025) */
  inputTokens: number | null;
  outputTokens: number | null;
}

export const PREVIEW_CHARS = 240;

const compact = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
};

/** En un chat, el último mensaje del usuario (entrada) o del asistente (salida); en el resto, el valor tal cual. */
export function previewOf(raw: string | null, side: "input" | "output", chat: boolean): string | null {
  if (!raw || raw.trim() === "") return null;
  if (!chat) return compact(raw);
  const messages = parseMessages(raw);
  const text = side === "input" ? lastOf(messages, "user") : (lastOf(messages, "assistant") ?? lastOf(messages, "unknown"));
  return text === null ? compact(raw) : compact(text);
}

export function toSpanRow({ inputRaw, outputRaw, chat, inputTokens, outputTokens, ...row }: SpanRecord, pricing: PricingCatalog = new Map()): SpanRow {
  return {
    ...row,
    input: previewOf(inputRaw, "input", chat),
    output: previewOf(outputRaw, "output", chat),
    costUsd: chat ? costOf(row.model, inputTokens ?? 0, outputTokens ?? 0, pricing) : null,
  };
}
