import type { PromptRef } from "@/domain/trace";
/** Una conversación = las trazas (turnos) que comparten `gen_ai.conversation.id` (ADR-012). */
export interface ConversationSummary {
  conversationId: string;
  serviceNames: string[];
  /** inicio del primer span */
  startTimeUs: number;
  /** fin del último turno */
  lastActivityUs: number;
  turnCount: number;
  /** turnos cuyo span raíz falló */
  errorTurns: number;
  /** spans fallidos en cualquier punto de la conversación */
  failedSpans: number;
  totalTokens: number;
  /** suma de las duraciones de los turnos: tiempo trabajando, sin las esperas del usuario */
  activeMs: number;
  /** versiones de prompt del registro que usó algún turno, la más reciente primero */
  prompts: PromptRef[];
}

/** Lo que el repositorio lee para dar título y coste a una conversación; el precio lo aplica el servicio (ADR-025). */
export interface ConversationUsage {
  /** JSON crudo de los mensajes de entrada del primer LLM de la conversación, `null` si no se capturó contenido */
  firstInput: string | null;
  /** tokens por modelo en las llamadas de chat */
  models: { model: string | null; inputTokens: number; outputTokens: number }[];
}

/** Resumen listo para mostrar: las cifras del repositorio más un título legible y el coste. */
export interface ConversationListItem extends ConversationSummary {
  /** el primer mensaje del usuario (≤ 120 caracteres); `null` si el agente no capturó contenido */
  title: string | null;
  /** `null` si ningún modelo de la conversación tiene precio conocido */
  costUsd: number | null;
}

/** Posición en el listado de conversaciones (keyset): última actividad dentro del rango + id. */
export interface ConversationCursor {
  lastActivityUs: number;
  conversationId: string;
}
