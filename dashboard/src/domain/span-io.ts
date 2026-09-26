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

function fromMessages(value: unknown): IoBlock[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((m) => typeof m === "object" && m !== null && "role" in m && "content" in m)) return null;

  const blocks = (value as { role: unknown; content: unknown; tool_calls?: unknown }[])
    .flatMap((m) => {
      const role = String(m.role);
      const text = textOf(m.content);
      const result: IoBlock[] = [];

      // Bloque principal con el contenido (si no está vacío)
      if (text.trim() && text !== "{}") {
        result.push({
          label: role,
          text,
          structured: typeof m.content !== "string" && text.trimStart().startsWith("{"),
          role: ROLES[role.toLowerCase()] ?? "other",
        });
      }

      // Si hay tool_calls, mostrarlos como bloque adicional (ReAct patterns)
      if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        result.push({
          label: "tool_calls",
          text: pretty(m.tool_calls),
          structured: true,
          role: "tool",
        });
      }

      return result;
    });

  return blocks.length > 0 ? blocks : null;
}

function single(label: string, value: unknown): IoBlock[] {
  // un string con JSON (el SDK guarda lo capturado como texto) se muestra con formato
  const text = pretty(value);
  const structured = typeof value !== "string" || /^\s*[{[]/.test(text);
  return [{ label, text, structured, role: "other" }];
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
    if (generic !== undefined) return { blocks: single(genericLabel, generic), raw: generic };
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
