import type { SpanNodeDto } from "@contract";
import { formatCount } from "./format";

/** Un bloque de texto del panel de entrada/salida de un span. */
export interface IoBlock {
  /** rol del mensaje ("user", "assistant"…) o el nombre del contenido ("Argumentos", "Resultado") */
  label: string;
  text: string;
  /** JSON o datos estructurados: se muestran en monoespaciada */
  structured: boolean;
  /** el mensaje es del usuario o del sistema (se tiñe distinto en la interfaz) */
  role: "user" | "assistant" | "system" | "tool" | "error" | "other";
  /** herramientas que el modelo pidió ejecutar en este mensaje */
  calls?: ToolCall[];
  /** el mensaje no tiene texto, solo llamadas a herramientas */
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

/** Llamadas a herramientas de un mensaje del modelo (LangChain `tool_calls`, formato OpenAI `function`). */
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
      // el contenido vacío solo se oculta si hay llamadas que mostrar en su lugar
      hideText: empty && calls.length > 0,
    };
  });
}

function single(label: string, value: unknown): IoBlock[] {
  // un string con JSON (el SDK guarda lo capturado como texto) se muestra con formato
  const text = pretty(value);
  const structured = typeof value !== "string" || /^\s*[{[]/.test(text);
  return [{ label, text, structured, role: "other", calls: [] }];
}

/** Entrada genérica de un grafo/cadena: `{"messages": [...]}` (o el string JSON de eso). */
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
 * Qué mostrar como entrada y salida de un span: mensajes de chat si es un LLM, argumentos y resultado si es una
 * herramienta, y la entrada/salida genérica en el resto. Vacío si el agente no capturó contenido (ADR-004).
 */
export function spanIo(node: SpanNodeDto): SpanIo {
  const c = node.content;
  if (!c) return { input: [], output: [], inputJson: "", outputJson: "" };
  const pick = (messages: unknown, tool: unknown, generic: unknown, toolLabel: string, genericLabel: string) => {
    if (messages !== undefined) return { blocks: fromMessages(messages) ?? single("mensajes", messages), raw: messages };
    if (tool !== undefined) return { blocks: single(toolLabel, tool), raw: tool };
    if (generic !== undefined) return { blocks: fromMessages(messagesIn(generic)) ?? single(genericLabel, generic), raw: generic };
    return { blocks: [], raw: undefined };
  };
  const input = pick(c.inputMessages, c.toolArguments, c.input, "argumentos", "entrada");
  const output = pick(c.outputMessages, c.toolResult, c.output, "resultado", "salida");
  return { input: input.blocks, output: output.blocks, inputJson: raw(input.raw), outputJson: raw(output.raw) };
}

const raw = (value: unknown): string => (value === undefined ? "" : pretty(value));

/** Datos GenAI del span como pares etiqueta/valor (los que no existen se omiten). */
export function genAiRows(node: SpanNodeDto): [string, string | number][] {
  const g = node.genAi;
  if (!g) return [];
  const num = (v: number | null) => (v === null ? null : formatCount(v));
  const rows: [string, string | number | null][] = [
    ["Operación", g.operation],
    ["Proveedor", g.provider],
    ["Modelo solicitado", g.requestModel],
    ["Modelo de respuesta", g.responseModel],
    ["Tokens de entrada", num(g.inputTokens)],
    ["Tokens de salida", num(g.outputTokens)],
    ["Tokens totales", num(g.totalTokens)],
    ["Motivo de fin", g.finishReasons.join(", ") || null],
    ["Temperatura", g.temperature],
    ["Máx. tokens", g.maxTokens],
    ["Herramienta", g.toolName],
    ["Id de llamada", g.toolCallId],
  ];
  return rows.filter((r): r is [string, string | number] => r[1] !== null && r[1] !== undefined);
}
