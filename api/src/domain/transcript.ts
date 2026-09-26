/** Un span de LLM con el contenido capturado (opt-in, ADR-004): JSON crudo tal y como está guardado. */
export interface ChatSpanRecord {
  traceId: string;
  startTimeUs: number;
  model: string | null;
  inputMessages: string | null;
  outputMessages: string | null;
}

export interface TranscriptTurn {
  traceId: string;
  startTimeUs: number;
  model: string | null;
  /** el mensaje del usuario que abre el turno */
  user: string | null;
  /** la respuesta final del agente */
  assistant: string | null;
}

export interface Transcript {
  conversationId: string;
  /** false: el agente no guardó contenido (MEMTRACE_CAPTURE_CONTENT desactivado) */
  contentCaptured: boolean;
  truncated: boolean;
  turns: TranscriptTurn[];
}

type Role = "user" | "assistant" | "system" | "tool" | "unknown";
interface Message {
  role: Role;
  text: string;
}

const ROLES: Record<string, Role> = {
  user: "user",
  human: "user",
  assistant: "assistant",
  ai: "assistant",
  system: "system",
  tool: "tool",
  function: "tool",
};

/** Texto de un `content`: string, lista de partes (multimodal) u otro JSON. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""));
    const joined = parts.filter(Boolean).join("\n");
    if (joined) return joined;
  }
  return content === undefined || content === null ? "" : JSON.stringify(content);
}

/**
 * El SDK trunca el contenido largo (`…[truncated]`), lo que deja un JSON inválido:
 * en ese caso se devuelve el texto crudo como un único mensaje sin rol en vez de perderlo.
 */
export function parseMessages(raw: string | null): Message[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({ role: ROLES[String(m.role ?? "").toLowerCase()] ?? "unknown", text: textOf(m.content).trim() }));
    }
  } catch {
    /* JSON truncado o texto plano */
  }
  return [{ role: "unknown", text: raw.trim() }];
}

export const lastOf = (messages: Message[], role: Role) => messages.filter((m) => m.role === role && m.text !== "").at(-1)?.text ?? null;

/**
 * Por turno (traza): el usuario es el último mensaje `user` de la entrada del primer LLM (el que acaba de
 * escribir; el historial anterior va antes) y el asistente el último mensaje `assistant` con texto de la salida
 * del último LLM (las salidas que solo llaman a herramientas no tienen texto y se saltan).
 */
export function buildTranscript(conversationId: string, records: ChatSpanRecord[], truncated: boolean): Transcript {
  const byTrace = new Map<string, ChatSpanRecord[]>();
  for (const r of [...records].sort((a, b) => a.startTimeUs - b.startTimeUs)) {
    const list = byTrace.get(r.traceId) ?? [];
    list.push(r);
    byTrace.set(r.traceId, list);
  }

  const turns: TranscriptTurn[] = [];
  for (const [traceId, spans] of byTrace) {
    const inputs = spans.map((s) => parseMessages(s.inputMessages));
    const outputs = spans.map((s) => parseMessages(s.outputMessages));
    const user = inputs.map((m) => lastOf(m, "user")).find((t) => t !== null) ?? null;
    const assistant = [...outputs].reverse().map((m) => lastOf(m, "assistant") ?? lastOf(m, "unknown")).find((t) => t !== null) ?? null;
    if (user === null && assistant === null) continue;
    turns.push({ traceId, startTimeUs: spans[0]!.startTimeUs, model: spans.at(-1)!.model, user, assistant });
  }

  const contentCaptured = records.some((r) => r.inputMessages || r.outputMessages);
  return { conversationId, contentCaptured, truncated, turns };
}
