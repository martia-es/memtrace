/** Reglas puras del panel de chat con un agente (ADR-055). */

export interface ChatMessage {
  id: number;
  role: "user" | "agent" | "error";
  text: string;
  /** traza de la respuesta (solo si el agente declara dónde viene): permite votar 👍/👎 (ADR-062) */
  traceId?: string | null;
  /** voto de quien prueba el chat sobre esta respuesta; null/ausente = sin votar */
  vote?: 1 | -1 | null;
}

/** Al pulsar el mismo botón otra vez se retira el voto; el otro botón lo cambia. */
export function nextVote(current: 1 | -1 | null | undefined, clicked: 1 | -1): 1 | -1 | null {
  return current === clicked ? null : clicked;
}

/** Texto listo para enviar, o null si no hay nada que enviar. */
export function normalizeDraft(draft: string): string | null {
  const text = draft.trim();
  return text === "" ? null : text;
}

/** Datos de la ficha con los que se decide si un entorno ofrece el botón «Talk». */
export interface Talkable {
  chat: { path: string } | null;
  deployments: Array<{ id: string; authMethod: string; apiUrl: string }>;
}

/** El botón aparece si el agente declara endpoint de chat y el despliegue no exige credenciales que MemTrace no guarda. */
export function canTalkTo(card: Pick<Talkable, "chat">, deployment: { authMethod: string; apiUrl: string }): boolean {
  return card.chat !== null && deployment.authMethod === "none" && deployment.apiUrl !== "";
}

/** URL que verá la persona en el panel: host del despliegue + path del agente. */
export function chatUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${path}`;
}
