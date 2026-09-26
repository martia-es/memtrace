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
}

/** Posición en el listado de conversaciones (keyset): última actividad dentro del rango + id. */
export interface ConversationCursor {
  lastActivityUs: number;
  conversationId: string;
}
