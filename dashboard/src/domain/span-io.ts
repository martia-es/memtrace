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

export interface SpanIoAdapter {
  name: string;
  matches(value: unknown): boolean;
  parse(value: unknown): IoBlock[];
}

const ROLES: Record<string, IoBlock["role"]> = {
  user: "user",
  human: "user",
  assistant: "assistant",
  ai: "assistant",
  system: "system",
  tool: "tool",
  function: "tool",
  model: "assistant",
};

const pretty = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

export const asObject = (v: unknown): Record<string, unknown> => {
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
export function toolCallsOf(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const o = c as { name?: unknown; id?: unknown; args?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = o.name ?? o.function?.name;
    if (typeof name !== "string") return [];
    return [{ name, id: typeof o.id === "string" ? o.id : null, args: asObject(o.args ?? o.arguments ?? o.function?.arguments) }];
  });
}

// ---------------------------------------------------------------------------
// Adaptadores por Framework
// ---------------------------------------------------------------------------

/**
 * Adaptador para LangChain / LangGraph (mensajes con 'role' y 'content').
 */
export const langchainAdapter: SpanIoAdapter = {
  name: "LangChain / LangGraph",
  matches(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((m) => typeof m === "object" && m !== null && "role" in m && "content" in m);
  },
  parse(value: unknown): IoBlock[] {
    return (value as { role: unknown; content: unknown; tool_calls?: unknown }[]).map((m) => {
      let role = String(m.role);
      // OpenTelemetry-style content: a list of typed parts (text, tool_call, tool_call_response)
      const calls = [...toolCallsOf(m.tool_calls), ...extractPartsToolCalls(m.content)];
      const toolOnly = isToolResponsePartOnly(m.content);
      if (toolOnly && role.toLowerCase() === "user") role = "tool";
      const empty = m.content === "" || (Array.isArray(m.content) && m.content.length === 0);
      const partsText = Array.isArray(m.content) && (calls.length > 0 || toolOnly) ? extractPartsText(m.content) : null;
      const text = partsText !== null ? partsText : empty ? (calls.length ? JSON.stringify(m.tool_calls, null, 2) : "") : textOfContent(m.content);
      const hideText = calls.length > 0 && (empty || (partsText !== null && !partsText.trim()));
      return {
        label: role,
        text: hideText ? "" : text,
        structured: toolOnly || (!empty && typeof m.content !== "string" && text.trimStart().startsWith("{")),
        role: ROLES[role.toLowerCase()] ?? "other",
        calls,
        hideText,
      };
    });
  },
};

/**
 * Adaptador para Google GenAI / Vertex / Pydantic AI (mensajes con 'parts').
 */
export const googleGenAiAdapter: SpanIoAdapter = {
  name: "Google GenAI / Pydantic AI",
  matches(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.some((m) => typeof m === "object" && m !== null && ("parts" in m || "role" in m));
  },
  parse(value: unknown): IoBlock[] {
    return (value as { role?: unknown; parts?: unknown; content?: unknown; tool_calls?: unknown }[]).map((m) => {
      let roleStr = String(m.role || "user");
      const calls = [...toolCallsOf(m.tool_calls), ...extractPartsToolCalls(m.parts)];
      const textFromParts = extractPartsText(m.parts ?? m.content);
      const isToolResponseOnly = isToolResponsePartOnly(m.parts);
      if (isToolResponseOnly && roleStr === "user") {
        roleStr = "tool";
      }
      const rawText = textFromParts || (typeof m.content === "string" ? m.content : "");
      const hideText = calls.length > 0 && !rawText.trim();
      const text = hideText ? "" : (rawText || pretty(m.parts ?? m.content ?? m));
      const structured = isToolResponseOnly || (roleStr === "tool" && text.trimStart().startsWith("{"));
      return {
        label: roleStr,
        text,
        structured,
        role: ROLES[roleStr.toLowerCase()] ?? "other",
        calls: calls.length > 0 ? calls : undefined,
        hideText,
      };
    });
  },
};

/**
 * Adaptador de fallback (valor simple, objeto genérico o array no estructurado).
 */
export const fallbackAdapter: SpanIoAdapter = {
  name: "Fallback (Generic Data)",
  matches(): boolean {
    return true;
  },
  parse(value: unknown): IoBlock[] {
    // Si viene como lista de mensajes de cualquier otro estilo
    const langResult = langchainAdapter.matches(value) ? langchainAdapter.parse(value) : null;
    if (langResult) return langResult;

    const genAiResult = googleGenAiAdapter.matches(value) ? googleGenAiAdapter.parse(value) : null;
    if (genAiResult) return genAiResult;

    return single("data", value);
  },
};

export const SUPPORTED_FRAMEWORK_ADAPTERS: SpanIoAdapter[] = [
  langchainAdapter,
  googleGenAiAdapter,
];

function isToolResponsePartOnly(parts: unknown): boolean {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  return parts.every((p) => p && typeof p === "object" && "type" in p && (p as { type: string }).type === "tool_call_response");
}

function extractPartsToolCalls(parts: unknown): ToolCall[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const obj = p as { type?: string; name?: string; id?: string; arguments?: unknown; args?: unknown };
    if (obj.type === "tool_call" && typeof obj.name === "string") {
      return [{ name: obj.name, id: typeof obj.id === "string" ? obj.id : null, args: asObject(obj.args ?? obj.arguments) }];
    }
    return [];
  });
}

function extractPartsText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts = parts.map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object") {
      if ("text" in p && typeof (p as { text: unknown }).text === "string") return (p as { text: string }).text;
      if ("content" in p && typeof (p as { content: unknown }).content === "string") return (p as { content: string }).content;
      if ("type" in p && (p as { type: string }).type === "tool_call_response") {
        const res = (p as { result?: unknown }).result;
        return res !== undefined ? pretty(res) : "";
      }
    }
    return "";
  });
  return texts.filter(Boolean).join("\n");
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""));
    const joined = parts.filter(Boolean).join("\n");
    if (joined) return joined;
  }
  return pretty(content);
}

function fromMessages(value: unknown): IoBlock[] | null {
  for (const adapter of SUPPORTED_FRAMEWORK_ADAPTERS) {
    if (adapter.matches(value)) {
      return adapter.parse(value);
    }
  }
  return null;
}

function single(label: string, value: unknown): IoBlock[] {
  const text = pretty(value);
  const structured = typeof value !== "string" || /^\s*[{[]/.test(text);
  return [{ label, text, structured, role: "other", calls: [] }];
}

/** A flat object of simple values (what `@trace_step` records: `{"message": "..."}`) as one labelled block per key.
 * Nested values keep the generic JSON rendering; the JSON tab always shows the raw data. */
function fromFlatObject(value: unknown): IoBlock[] | null {
  const obj = typeof value === "string" && value.trimStart().startsWith("{") ? asObject(value) : value;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([, v]) => v !== null && typeof v === "object")) return null;
  return entries.map(([key, v]) => ({ label: key, text: v === null ? "null" : String(v), structured: false, role: "other", calls: [] }));
}

function messagesIn(value: unknown): unknown {
  const obj = typeof value === "string" && value.trimStart().startsWith("{") ? asObject(value) : value;
  return obj && typeof obj === "object" && "messages" in obj ? (obj as { messages: unknown }).messages : undefined;
}

export interface SpanIo {
  /** the whole conversation in its real order, when the span carries it (Pydantic AI); input/output split it by role */
  ordered?: IoBlock[];
  input: IoBlock[];
  output: IoBlock[];
  inputJson: string;
  outputJson: string;
}

export function spanIo(node: SpanNodeDto): SpanIo {
  // Pydantic AI full conversation trace in span attributes
  const allMessagesAttr = node.attributes["pydantic_ai.all_messages"];
  if (allMessagesAttr) {
    try {
      const parsed = JSON.parse(allMessagesAttr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const blocks = fromMessages(parsed) ?? [];
        if (blocks.length > 0) {
          // input = the history up to the user's last message, output = what the agent did after it: both keep the real order
          const lastUser = blocks.map((b) => b.role).lastIndexOf("user");
          const split = lastUser >= 0 && lastUser < blocks.length - 1 ? lastUser + 1 : Math.max(1, blocks.length - 1);
          return {
            ordered: blocks,
            input: blocks.slice(0, split),
            output: blocks.slice(split),
            inputJson: pretty(parsed),
            outputJson: pretty(parsed),
          };
        }
      }
    } catch {
      // fallback to node.content
    }
  }

  const c = node.content;
  if (!c) return { input: [], output: [], inputJson: "", outputJson: "" };
  const pick = (messages: unknown, tool: unknown, generic: unknown, toolLabel: string, genericLabel: string) => {
    if (messages !== undefined) return { blocks: fromMessages(messages) ?? single("messages", messages), raw: messages };
    if (tool !== undefined) return { blocks: single(toolLabel, tool), raw: tool };
    if (generic !== undefined) return { blocks: fromMessages(messagesIn(generic)) ?? fromFlatObject(generic) ?? single(genericLabel, generic), raw: generic };
    return { blocks: [], raw: undefined };
  };
  const input = pick(c.inputMessages, c.toolArguments, c.input, "arguments", "input");
  const output = pick(c.outputMessages, c.toolResult, c.output, "result", "output");
  return { input: input.blocks, output: output.blocks, inputJson: raw(input.raw), outputJson: raw(output.raw) };
}

const raw = (value: unknown): string => (value === undefined ? "" : pretty(value));

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
