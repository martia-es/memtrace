/** Builds span attributes from domain concepts. No OpenTelemetry, no frameworks. */
import { sc, type StepType } from "./semconv.js";

export type Attributes = Record<string, unknown>; // undefined values are dropped before reaching the span

export interface LlmCall {
  provider?: string;
  model?: string;
  operation?: string;
  responseModel?: string;
  responseId?: string;
  finishReasons?: readonly string[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

const OPERATION_BY_STEP_TYPE: Record<string, string> = {
  llm: "chat", tool: "execute_tool", agent: "invoke_agent", retriever: "retrieval", embedding: "embeddings",
};

const PROVIDER_ALIASES: Record<string, string> = {
  google_genai: "gcp.gemini", google_vertexai: "gcp.vertex_ai", vertexai: "gcp.vertex_ai", bedrock: "aws.bedrock",
  amazon_bedrock: "aws.bedrock", azure: "azure.ai.openai", azure_openai: "azure.ai.openai",
};
const MODEL_PREFIX_PROVIDERS: Array<[string, string]> = [
  ["gpt", "openai"], ["o1", "openai"], ["o3", "openai"], ["o4", "openai"], ["claude", "anthropic"], ["gemini", "gcp.gemini"],
  ["mistral", "mistral_ai"], ["command", "cohere"], ["llama", "meta"],
];

/** Normalizes the provider name; if missing, infers it from the model name. */
export function normalizeProvider(provider?: string, model?: string): string | undefined {
  if (provider) {
    const p = provider.trim().toLowerCase().split("-")[0] ?? "";
    return PROVIDER_ALIASES[p] ?? p;
  }
  const name = (model ?? "").toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([prefix]) => name.startsWith(prefix))?.[1];
}

export function stepStartAttributes(stepType: StepType, sessionId?: string): Attributes {
  return {
    [sc.MEMTRACE_STEP_TYPE]: stepType,
    [sc.GEN_AI_OPERATION_NAME]: OPERATION_BY_STEP_TYPE[stepType],
    [sc.GEN_AI_CONVERSATION_ID]: sessionId,
  };
}

export function stepInputAttributes(stepType: StepType, name: string, captured?: string): Attributes {
  return stepType === "tool"
    ? { [sc.GEN_AI_TOOL_NAME]: name, [sc.GEN_AI_TOOL_CALL_ARGUMENTS]: captured }
    : { [sc.MEMTRACE_INPUT]: captured };
}

export function stepOutputAttributes(stepType: StepType, captured?: string): Attributes {
  return { [stepType === "tool" ? sc.GEN_AI_TOOL_CALL_RESULT : sc.MEMTRACE_OUTPUT]: captured };
}

export function resolvedTotalTokens(call: LlmCall): number | undefined {
  if (call.totalTokens !== undefined) return call.totalTokens;
  if (call.inputTokens === undefined && call.outputTokens === undefined) return undefined;
  return (call.inputTokens ?? 0) + (call.outputTokens ?? 0);
}

/** `inputMessages` / `outputMessages` are JSON text already filtered by the capture policy. */
export function llmAttributes(call: LlmCall, inputMessages?: string, outputMessages?: string): Attributes {
  return {
    [sc.GEN_AI_OPERATION_NAME]: call.operation ?? "chat",
    [sc.GEN_AI_PROVIDER_NAME]: normalizeProvider(call.provider, call.model),
    [sc.GEN_AI_REQUEST_MODEL]: call.model,
    [sc.GEN_AI_RESPONSE_MODEL]: call.responseModel,
    [sc.GEN_AI_RESPONSE_ID]: call.responseId,
    [sc.GEN_AI_RESPONSE_FINISH_REASONS]: call.finishReasons && call.finishReasons.length > 0 ? [...call.finishReasons] : undefined,
    [sc.GEN_AI_USAGE_INPUT_TOKENS]: call.inputTokens,
    [sc.GEN_AI_USAGE_OUTPUT_TOKENS]: call.outputTokens,
    [sc.GEN_AI_USAGE_TOTAL_TOKENS]: resolvedTotalTokens(call),
    [sc.GEN_AI_REQUEST_TEMPERATURE]: call.temperature,
    [sc.GEN_AI_REQUEST_MAX_TOKENS]: call.maxTokens,
    [sc.GEN_AI_REQUEST_TOP_P]: call.topP,
    [sc.GEN_AI_REQUEST_FREQUENCY_PENALTY]: call.frequencyPenalty,
    [sc.GEN_AI_REQUEST_PRESENCE_PENALTY]: call.presencePenalty,
    [sc.GEN_AI_INPUT_MESSAGES]: inputMessages,
    [sc.GEN_AI_OUTPUT_MESSAGES]: outputMessages,
  };
}

/** Valid OTel attribute value: a primitive or a homogeneous array; anything else, JSON text. */
export function sanitizeValue(value: unknown): string | number | boolean | string[] | number[] | boolean[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length > 0) {
    const kind = typeof value[0];
    if ((kind === "string" || kind === "number" || kind === "boolean") && value.every((v) => typeof v === kind)) {
      return [...value] as string[] | number[] | boolean[];
    }
  }
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

/** Drops undefined/null values (absent != empty) and coerces the rest. */
export function sanitize(attrs: Attributes): Record<string, ReturnType<typeof sanitizeValue>> {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, sanitizeValue(v)]),
  );
}
