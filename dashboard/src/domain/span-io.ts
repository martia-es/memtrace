import type { SpanNodeDto } from "@contract";
import { formatCount } from "./format";

/** A text block from the input/output panel of a span. */
export interface IoBlock {
  /** role of the message ("user", "assistant"…) or name of the content ("Arguments", "Result") */
  label: string;
  text: string;
  /** JSON or structured data: displayed in monospace */
  structured: boolean;
  /** the message is from user or system (colored differently in the interface) */
  role: "user" | "assistant" | "system" | "tool" | "error" | "other";
  /** tools the model requested to execute in this message */
  calls?: ToolCall[];
  /** the message has no text, only tool calls */
  hideText?: boolean;
}

export interface ToolCall {
  name: string;
  id: string | null;
  args: Record<string, unknown>;
}

const ROLES: Record<string, IoBlock["role"]> = { user: "user", human: "user", assistant: "assistant", ai: "assistant", system: "system", tool: "tool", function: "tool" };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""));
    const joined = parts.filter(Boolean).join("\n");
    if (joined) return joined;
  }
  return JSON.stringify(content, null, 2);
};

const pretty = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

const asObject = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: v };
    } catch {
      return { value: v };
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : v === undefined || v === null ? {} : { value: v };
};

/** Tool calls from a model message (LangChain `tool_calls`, OpenAI `function` format). */
function toolCallsOf(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const o = c as { name?: unknown; id?: unknown; args?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = o.name ?? o.function?.name;
    if (typeof name !== "string") return [];
    return [{ name, id: typeof o.id === "string" ? o.id : null, args: asObject(o.args ?? o.arguments ?? o.function?.arguments) }];
  });
}

function fromMessages(value: unknown): IoBlock[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((m) => typeof m === "object" && m !== null && "role" in m && "content" in m)) return null;
  return (value as { role: unknown; content: unknown; tool_calls?: unknown }[]).map((m) => {
    const role = String(m.role);
    const calls = toolCallsOf(m.tool_calls);
    const empty = m.content === "" || (Array.isArray(m.content) && m.content.length === 0);
    const text = empty ? (calls.length ? JSON.stringify(m.tool_calls, null, 2) : "") : textOf(m.content);
    return {
      label: role,
      text,
      structured: !empty && typeof m.content !== "string" && text.trimStart().startsWith("{"),
      role: ROLES[role.toLowerCase()] ?? "other",
      calls,
      // empty content is only hidden if there are calls to display instead
      hideText: empty && calls.length > 0,
    };
  });
}

function single(label: string, value: unknown): IoBlock[] {
  // a string with JSON (the SDK saves captured content as text) is displayed formatted
  const text = pretty(value);
  const structured = typeof value !== "string" || /^\s*[{[]/.test(text);
  return [{ label, text, structured, role: "other", calls: [] }];
}

/** Generic graph/chain input: `{"messages": [...]}` (or its JSON string). */
function messagesIn(value: unknown): unknown {
  const obj = typeof value === "string" && value.trimStart().startsWith("{") ? asObject(value) : value;
  return obj && typeof obj === "object" && "messages" in obj ? (obj as { messages: unknown }).messages : undefined;
}

export interface SpanIo {
  input: IoBlock[];
  output: IoBlock[];
  /** el contenido original de cada lado, formateado como JSON (modo "JSON" del panel) */
  inputJson: string;
  outputJson: string;
}

/**
 * What to show as span input and output: chat messages if it's an LLM, arguments and result if it's a
 * tool, and generic input/output for the rest. Empty if the agent didn't capture content (ADR-004).
 */
export function spanIo(node: SpanNodeDto): SpanIo {
  const c = node.content;
  if (!c) return { input: [], output: [], inputJson: "", outputJson: "" };
  const pick = (messages: unknown, tool: unknown, generic: unknown, toolLabel: string, genericLabel: string) => {
    if (messages !== undefined) return { blocks: fromMessages(messages) ?? single("messages", messages), raw: messages };
    if (tool !== undefined) return { blocks: single(toolLabel, tool), raw: tool };
    if (generic !== undefined) return { blocks: fromMessages(messagesIn(generic)) ?? single(genericLabel, generic), raw: generic };
    return { blocks: [], raw: undefined };
  };
  const input = pick(c.inputMessages, c.toolArguments, c.input, "arguments", "input");
  const output = pick(c.outputMessages, c.toolResult, c.output, "result", "output");
  return { input: input.blocks, output: output.blocks, inputJson: raw(input.raw), outputJson: raw(output.raw) };
}

const raw = (value: unknown): string => (value === undefined ? "" : pretty(value));

/** GenAI data from the span as label/value pairs (non-existent ones are omitted). */
export function genAiRows(node: SpanNodeDto): [string, string | number][] {
  const g = node.genAi;
  if (!g) return [];
  const num = (v: number | null) => (v === null ? null : formatCount(v));
  const rows: [string, string | number | null][] = [
    ["Operation", g.operation],
    ["Provider", g.provider],
    ["Request model", g.requestModel],
    ["Response model", g.responseModel],
    ["Input tokens", num(g.inputTokens)],
    ["Output tokens", num(g.outputTokens)],
    ["Total tokens", num(g.totalTokens)],
    ["Finish reason", g.finishReasons.join(", ") || null],
    ["Temperature", g.temperature],
    ["Max tokens", g.maxTokens],
    ["Tool", g.toolName],
    ["Tool call ID", g.toolCallId],
  ];
  return rows.filter((r): r is [string, string | number] => r[1] !== null && r[1] !== undefined);
}
