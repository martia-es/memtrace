/**
 * Tracing processor for the OpenAI Agents SDK for JavaScript (ADR-095): turns its traces and spans into MemTrace steps, with the
 * same attributes as the Python integration.
 *
 *     import { enableOpenAIAgentsInstrumentation } from "@memtrace-ai/sdk/openai-agents";
 *     enableOpenAIAgentsInstrumentation();   // after initTracer
 *
 * Needs `@openai/agents` (a peer dependency).
 */
import { addTraceProcessor, setTraceProcessors, type Span, type Trace, type TracingProcessor } from "@openai/agents";
import { capture, capturesContent, endRun, llmAttributes, sc, startRun, type Attributes } from "@memtrace-ai/sdk";

export const FRAMEWORK = "openai-agents";

const usageOf = (usage: any): [number | undefined, number | undefined] =>
  [typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined, typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined];

/** `mcp_data` arrives as text: JSON with a `server`, or just the server's name. */
function mcpServer(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.server === "string" ? parsed.server : typeof parsed?.server_label === "string" ? parsed.server_label : undefined;
  } catch {
    return raw;
  }
}

export class MemTraceTracingProcessor implements TracingProcessor {
  private readonly runs = new Map<string, string>(); // Agents SDK trace / span id -> MemTrace run id
  private readonly sessions = new Map<string, string | undefined>(); // trace id -> groupId (the conversation)

  private common(traceId: string): Attributes {
    return { [sc.MEMTRACE_FRAMEWORK]: FRAMEWORK, [sc.GEN_AI_CONVERSATION_ID]: this.sessions.get(traceId) };
  }

  async onTraceStart(trace: Trace): Promise<void> {
    try {
      this.sessions.set(trace.traceId, trace.groupId ?? undefined);
      const attributes: Attributes = { ...this.common(trace.traceId) };
      if (trace.metadata && Object.keys(trace.metadata).length > 0) attributes[sc.MEMTRACE_METADATA] = capture(trace.metadata);
      this.runs.set(trace.traceId, startRun(trace.name || "Agent workflow", "chain", { attributes }));
    } catch { /* instrumentation never breaks the agent */ }
  }

  async onTraceEnd(trace: Trace): Promise<void> {
    try {
      const run = this.runs.get(trace.traceId);
      this.runs.delete(trace.traceId);
      this.sessions.delete(trace.traceId);
      if (run) endRun(run);
    } catch { /* ignore */ }
  }

  async onSpanStart(span: Span<any>): Promise<void> {
    try {
      const [name, type, attrs] = this.describe(span.spanData);
      const parent = span.parentId ? this.runs.get(span.parentId) : this.runs.get(span.traceId);
      this.runs.set(span.spanId, startRun(name, type, { parentRunId: parent, attributes: { ...this.common(span.traceId), ...attrs } }));
    } catch { /* ignore */ }
  }

  async onSpanEnd(span: Span<any>): Promise<void> {
    try {
      const run = this.runs.get(span.spanId);
      this.runs.delete(span.spanId);
      if (!run) return;
      const error = span.error ? new Error(span.error.message || "error") : undefined;
      endRun(run, { error, attributes: this.onEnd(span.spanData) });
    } catch { /* ignore */ }
  }

  async shutdown(): Promise<void> { this.runs.clear(); this.sessions.clear(); }
  async forceFlush(): Promise<void> {}

  // ----- mapping -----

  private describe(data: any): [string, "chain" | "tool" | "llm", Attributes] {
    switch (data.type) {
      case "agent": {
        const md = { handoffs: data.handoffs, tools: data.tools, output_type: data.output_type };
        const present = Object.fromEntries(Object.entries(md).filter(([, v]) => v && (!Array.isArray(v) || v.length > 0)));
        return [data.name, "chain", { [sc.MEMTRACE_METADATA]: Object.keys(present).length > 0 ? capture(present) : undefined }];
      }
      case "task": return [data.name || "task", "chain", {}];
      case "turn": return [`turn ${data.turn}`, "chain", {}]; // its usage is the sum of its model calls: not copied, tokens count once
      case "function": return [data.name, "tool", { [sc.GEN_AI_TOOL_NAME]: data.name, [sc.MEMTRACE_MCP_SERVER]: mcpServer(data.mcp_data) }];
      case "generation": return [data.model ? `openai: ${data.model}` : "openai", "llm", {}];
      case "response": return ["openai", "llm", {}];
      case "handoff":
        return [`handoff: ${data.from_agent} -> ${data.to_agent}`, "chain", { [sc.MEMTRACE_METADATA]: capture({ from_agent: data.from_agent, to_agent: data.to_agent }) }];
      case "guardrail": return [`guardrail: ${data.name}`, "chain", {}];
      case "mcp_tools": return [`mcp list tools: ${data.server}`, "tool", { [sc.MEMTRACE_MCP_SERVER]: data.server || undefined }];
      default: return [data.name || data.type, "chain", {}];
    }
  }

  private onEnd(data: any): Attributes {
    const captures = capturesContent();
    switch (data.type) {
      case "function":
        return {
          [sc.GEN_AI_TOOL_CALL_ARGUMENTS]: capture(data.input), [sc.GEN_AI_TOOL_CALL_RESULT]: capture(data.output),
          [sc.MEMTRACE_MCP_SERVER]: mcpServer(data.mcp_data), // may be filled in after the span opened
        };
      case "generation": {
        const [inputTokens, outputTokens] = usageOf(data.usage), config = data.model_config ?? {};
        return llmAttributes(
          { provider: "openai", model: data.model, inputTokens, outputTokens, temperature: config.temperature, maxTokens: config.max_tokens, topP: config.top_p },
          captures ? capture(data.input) : undefined, captures ? capture(data.output) : undefined,
        );
      }
      case "response": {
        const response = data._response ?? {};
        const [inputTokens, outputTokens] = usageOf(response.usage);
        return llmAttributes(
          { provider: "openai", model: response.model, responseModel: response.model, responseId: response.id ?? data.response_id, inputTokens, outputTokens, temperature: response.temperature ?? undefined, topP: response.top_p ?? undefined },
          captures ? capture(data._input) : undefined, captures ? capture(response.output) : undefined,
        );
      }
      case "guardrail": return { [sc.MEMTRACE_METADATA]: capture({ triggered: data.triggered }) };
      case "mcp_tools": return { [sc.GEN_AI_TOOL_CALL_RESULT]: capture(data.result) };
      default: return {};
    }
  }
}

let installed: MemTraceTracingProcessor | undefined;

/**
 * Registers a MemTrace tracing processor with the OpenAI Agents SDK, for all agents. Safe to call more than once. The Agents SDK also
 * uploads its traces to the OpenAI dashboard by default: pass `keepOpenAIExport: false` to send them only to MemTrace.
 */
export function enableOpenAIAgentsInstrumentation(options: { keepOpenAIExport?: boolean } = {}): MemTraceTracingProcessor {
  if (installed) return installed;
  const processor = new MemTraceTracingProcessor();
  if (options.keepOpenAIExport === false) setTraceProcessors([processor]);
  else addTraceProcessor(processor);
  return (installed = processor);
}
