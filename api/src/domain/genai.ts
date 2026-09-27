import type { GenAiInfo, SpanContent } from "./span";

const STEP_TYPE = "memtrace.step_type";
const FRAMEWORK = "memtrace.framework";

// atributo (ADR-004) -> campo de SpanContent
const CONTENT_KEYS: Record<string, keyof SpanContent> = {
  "gen_ai.input.messages": "inputMessages",
  "gen_ai.output.messages": "outputMessages",
  "gen_ai.tool.call.arguments": "toolArguments",
  "gen_ai.tool.call.result": "toolResult",
  "memtrace.input": "input",
  "memtrace.output": "output",
};

const GENAI_KEYS = [
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.total_tokens",
  "gen_ai.response.finish_reasons",
  "gen_ai.request.temperature",
  "gen_ai.request.max_tokens",
  "gen_ai.tool.name",
  "gen_ai.tool.call.id",
];

/** Atributos ya representados en `kind`, `genAi` o `content`: no se repiten en `attributes`. */
const CONSUMED = new Set([STEP_TYPE, FRAMEWORK, ...GENAI_KEYS, ...Object.keys(CONTENT_KEYS)]);

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function parseFinishReasons(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* no era JSON: valor suelto */
  }
  return [raw];
}

function parseJsonOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function extractKind(attributes: Record<string, string>): string {
  return str(attributes[STEP_TYPE]) ?? "unknown";
}

/** Devuelve null si el span no lleva ningún atributo GenAI. */
export function extractGenAi(attributes: Record<string, string>): GenAiInfo | null {
  if (!GENAI_KEYS.some((key) => key in attributes)) return null;
  return {
    operation: str(attributes["gen_ai.operation.name"]),
    provider: str(attributes["gen_ai.provider.name"]),
    requestModel: str(attributes["gen_ai.request.model"]),
    responseModel: str(attributes["gen_ai.response.model"]),
    inputTokens: num(attributes["gen_ai.usage.input_tokens"]),
    outputTokens: num(attributes["gen_ai.usage.output_tokens"]),
    totalTokens: num(attributes["gen_ai.usage.total_tokens"]),
    finishReasons: parseFinishReasons(attributes["gen_ai.response.finish_reasons"]),
    temperature: num(attributes["gen_ai.request.temperature"]),
    maxTokens: num(attributes["gen_ai.request.max_tokens"]),
    toolName: str(attributes["gen_ai.tool.name"]),
    toolCallId: str(attributes["gen_ai.tool.call.id"]),
  };
}

/** Devuelve null si no se capturó contenido. */
export function extractContent(attributes: Record<string, string>): SpanContent | null {
  const content: SpanContent = {};
  for (const [key, field] of Object.entries(CONTENT_KEYS)) {
    const raw = attributes[key];
    if (raw !== undefined && raw !== "") content[field] = parseJsonOrRaw(raw);
  }
  return Object.keys(content).length > 0 ? content : null;
}

export function remainingAttributes(attributes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !CONSUMED.has(key)));
}

/** Tokens de una llamada: el total reportado o, si falta, entrada + salida. */
export function tokensOf(info: GenAiInfo): number {
  if (info.totalTokens !== null) return info.totalTokens;
  return (info.inputTokens ?? 0) + (info.outputTokens ?? 0);
}
