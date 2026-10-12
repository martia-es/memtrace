/**
 * LangChain.js / LangGraph.js callback handler (ADR-024, ADR-095): turns the runs LangChain reports into MemTrace steps.
 *
 *     import { MemTraceCallbackHandler } from "@memtrace-ai/sdk/langchain";
 *     await chain.invoke(input, { callbacks: [new MemTraceCallbackHandler()] });
 *
 * Inside a `withStep`, its spans hang from it. Needs `@langchain/core` (a peer dependency). Same attributes as the Python handler.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
  capture, capturesContent, endRun, llmAttributes, noteRetrieved, retrievedChunks, sc, startRun, type Attributes, type LlmCall,
} from "@memtrace-ai/sdk";

type Meta = Record<string, any> | undefined;
type Serialized = { id?: string[]; name?: string } | undefined;

const asInt = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const get = (obj: any, key: string): any => (obj && typeof obj === "object" ? obj[key] : undefined);

/** (input, output, total) from `usage_metadata` (LangChain), `tokenUsage` / `token_usage` (OpenAI) or `usage` (Anthropic). */
function tokens(usage: any): [number | undefined, number | undefined, number | undefined] {
  if (!usage) return [undefined, undefined, undefined];
  const input = asInt(usage.input_tokens) ?? asInt(usage.promptTokens) ?? asInt(usage.prompt_tokens);
  const output = asInt(usage.output_tokens) ?? asInt(usage.completionTokens) ?? asInt(usage.completion_tokens);
  return [input, output, asInt(usage.total_tokens) ?? asInt(usage.totalTokens)];
}

/** Response data of an `LLMResult` (duck-typed): messages first, `llmOutput` as a fallback. */
export function responseToCall(response: any): LlmCall {
  let input: number | undefined, output: number | undefined, total: number | undefined;
  let model: string | undefined, responseId: string | undefined;
  const finish: string[] = [];
  for (const gens of response?.generations ?? []) {
    for (const gen of gens ?? []) {
      const msg = gen?.message;
      const meta = msg?.response_metadata ?? {};
      const info = gen?.generationInfo ?? gen?.generation_info ?? {};
      if (input === undefined && output === undefined) [input, output, total] = tokens(msg?.usage_metadata);
      model = model ?? meta.model_name ?? meta.model;
      responseId = responseId ?? msg?.id ?? meta.id;
      const reason = info.finish_reason ?? meta.finish_reason ?? meta.stop_reason;
      if (reason) finish.push(String(reason));
    }
  }
  const llmOutput = response?.llmOutput ?? response?.llm_output ?? {};
  if (input === undefined && output === undefined) [input, output, total] = tokens(llmOutput.tokenUsage ?? llmOutput.token_usage ?? llmOutput.usage);
  model = model ?? llmOutput.model_name ?? llmOutput.model;
  return { responseModel: model, responseId, finishReasons: finish, inputTokens: input, outputTokens: output, totalTokens: total };
}

export function requestToCall(metadata: Meta, params: Record<string, any> | undefined): LlmCall {
  const md = metadata ?? {}, p = params ?? {};
  return {
    provider: md.ls_provider ?? p._type,
    model: md.ls_model_name ?? p.model_name ?? p.model ?? p.model_id ?? p.modelName,
    temperature: md.ls_temperature ?? p.temperature,
    maxTokens: md.ls_max_tokens ?? p.max_tokens ?? p.maxTokens ?? p.max_tokens_to_sample,
    topP: p.top_p ?? p.topP,
    frequencyPenalty: p.frequency_penalty ?? p.frequencyPenalty,
    presencePenalty: p.presence_penalty ?? p.presencePenalty,
  };
}

/** `serialized` may be missing (LangGraph, runnables); LangChain passes `name` separately. */
export function stepName(serialized: Serialized, name: string | undefined, fallback: string): string {
  const id = serialized?.id;
  return name ?? serialized?.name ?? (id && id.length > 0 ? id[id.length - 1] : undefined) ?? fallback;
}

const toolCallsOf = (msg: any): unknown => {
  const calls = msg?.tool_calls ?? msg?.additional_kwargs?.tool_calls;
  return calls && calls.length > 0 ? calls : undefined;
};

export function messageDicts(messages: any[][]): Array<Record<string, unknown>> {
  return messages.flatMap((batch) => batch.map((m) => {
    const d: Record<string, unknown> = { role: m?._getType?.() ?? m?.type ?? m?.role ?? "user", content: m?.content ?? String(m) };
    const calls = toolCallsOf(m);
    if (calls) d.tool_calls = calls;
    return d;
  }));
}

export function generationDicts(response: any): Array<Record<string, unknown>> {
  return (response?.generations ?? []).flatMap((gens: any[]) => gens.map((g) => {
    const msg = g?.message;
    const d: Record<string, unknown> = { role: msg?._getType?.() ?? msg?.type ?? "assistant", content: g?.text ?? "" };
    const calls = toolCallsOf(msg);
    if (calls) d.tool_calls = calls;
    return d;
  }));
}

export class MemTraceCallbackHandler extends BaseCallbackHandler {
  name = "memtrace_callback_handler";

  private contextAttributes(tags: string[] | undefined, metadata: Meta): Attributes {
    const md = metadata ?? {};
    return {
      [sc.MEMTRACE_TAGS]: tags && tags.length > 0 ? tags.map(String) : undefined,
      [sc.MEMTRACE_METADATA]: Object.keys(md).length > 0 ? capture(md) ?? undefined : undefined,
      // `thread_id` is the LangGraph conversation identifier
      [sc.GEN_AI_CONVERSATION_ID]: md.session_id ?? md.conversation_id ?? md.thread_id,
      [sc.ENDUSER_ID]: md.user_id,
      // the graph's own root run has no `langgraph_*` keys, only `ls_integration`
      [sc.MEMTRACE_FRAMEWORK]: md.ls_integration === "langgraph" || Object.keys(md).some((k) => k.startsWith("langgraph_")) ? "langgraph" : "langchain",
    };
  }

  private start(name: string, type: "chain" | "tool" | "retriever" | "llm", runId: string, parentRunId: string | undefined, tags: string[] | undefined, metadata: Meta, extra: Attributes = {}): void {
    startRun(name, type, { runId, parentRunId, attributes: { ...this.contextAttributes(tags, metadata), ...extra } });
  }

  // ----- chains / agents -----

  handleChainStart(chain: any, inputs: any, runId: string, parentRunId?: string, tags?: string[], metadata?: Meta, _runType?: string, name?: string): void {
    this.start(stepName(chain, name, "Chain"), "chain", runId, parentRunId, tags, metadata, { [sc.MEMTRACE_INPUT]: capture(inputs) });
  }
  handleChainEnd(outputs: any, runId: string): void { endRun(runId, { attributes: { [sc.MEMTRACE_OUTPUT]: capture(outputs) } }); }
  handleChainError(error: unknown, runId: string): void { endRun(runId, { error }); }

  // ----- tools -----

  handleToolStart(tool: any, input: string, runId: string, parentRunId?: string, tags?: string[], metadata?: Meta, name?: string): void {
    const toolName = stepName(tool, name, "Tool");
    this.start(toolName, "tool", runId, parentRunId, tags, metadata, { [sc.GEN_AI_TOOL_NAME]: toolName, [sc.GEN_AI_TOOL_CALL_ARGUMENTS]: capture(input) });
  }
  handleToolEnd(output: any, runId: string): void {
    endRun(runId, { attributes: { [sc.GEN_AI_TOOL_CALL_RESULT]: capture(output?.content ?? output) } }); // a ToolMessage or a plain value
  }
  handleToolError(error: unknown, runId: string): void { endRun(runId, { error }); }

  // ----- retrievers -----

  handleRetrieverStart(retriever: any, query: string, runId: string, parentRunId?: string, tags?: string[], metadata?: Meta, name?: string): void {
    this.start(stepName(retriever, name, "Retriever"), "retriever", runId, parentRunId, tags, metadata, { [sc.MEMTRACE_INPUT]: capture(query) });
  }
  handleRetrieverEnd(documents: any[], runId: string): void {
    const chunks = retrievedChunks(documents);
    noteRetrieved(chunks);
    endRun(runId, { attributes: { [sc.MEMTRACE_RETRIEVER_DOCUMENTS]: chunks.length, [sc.MEMTRACE_RETRIEVER_CHUNKS]: capture(chunks) } });
  }
  handleRetrieverError(error: unknown, runId: string): void { endRun(runId, { error }); }

  // ----- LLMs -----

  private llmStart(llm: Serialized, runId: string, parentRunId: string | undefined, tags: string[] | undefined, metadata: Meta, params: Record<string, any> | undefined, input: unknown): void {
    const call = requestToCall(metadata, params);
    const base = stepName(llm, undefined, "llm");
    this.start(call.model ? `${base}: ${call.model}` : base, "llm", runId, parentRunId, tags, metadata, llmAttributes(call, capture(input)));
  }

  handleChatModelStart(llm: any, messages: any[][], runId: string, parentRunId?: string, extraParams?: Record<string, any>, tags?: string[], metadata?: Meta): void {
    this.llmStart(llm, runId, parentRunId, tags, metadata, extraParams?.invocation_params ?? extraParams, capturesContent() ? messageDicts(messages) : undefined);
  }
  handleLLMStart(llm: any, prompts: string[], runId: string, parentRunId?: string, extraParams?: Record<string, any>, tags?: string[], metadata?: Meta): void {
    this.llmStart(llm, runId, parentRunId, tags, metadata, extraParams?.invocation_params ?? extraParams, prompts.map((content) => ({ role: "user", content })));
  }
  handleLLMEnd(output: any, runId: string): void {
    let attributes: Attributes | undefined;
    try {
      attributes = llmAttributes(responseToCall(output), undefined, capturesContent() ? capture(generationDicts(output)) : undefined);
    } catch { /* an unexpectedly shaped response must not lose the span */ }
    endRun(runId, { attributes });
  }
  handleLLMError(error: unknown, runId: string): void { endRun(runId, { error }); }
}
