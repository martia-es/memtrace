/** Feedback del usuario final (ADR-062): 👍/👎 sobre la respuesta de un agente, ligado a su traza. */
import { UserFeedbackValueError } from "@/domain/errors";

export type FeedbackRating = 1 | -1;

/** Un voto vigente. `spanId = null` valora la respuesta entera. */
export interface UserFeedback {
  traceId: string;
  spanId: string | null;
  rating: FeedbackRating;
  comment: string | null;
  /** Pseudónimo que manda el agente; `null` = anónimo (se deduplica por traza). */
  endUserId: string | null;
  /** Id del mensaje en la app del agente: metadato, la clave sigue siendo la traza. */
  externalMessageId: string | null;
  createdAt: string;
}

export interface FeedbackSummary {
  total: number;
  up: number;
  down: number;
  /** % de 👍 sobre los votos, 0-100; `null` sin votos */
  satisfaction: number | null;
  /** trazas distintas del rango con algún voto */
  ratedTraces: number;
}

export interface FeedbackDay {
  day: string;
  up: number;
  down: number;
}

/** Estado de feedback de una traza o conversación, para las listas. */
export interface FeedbackRatingSummary {
  id: string;
  up: number;
  down: number;
}

/** Relación entre el voto del usuario y la revisión interna (anotaciones humanas y scores booleanos). */
export type FeedbackAlignment = "aligned" | "misaligned" | "unknown";

export function validateRating(rating: unknown): FeedbackRating {
  if (rating !== 1 && rating !== -1) throw new UserFeedbackValueError("rating must be 1 (thumbs up) or -1 (thumbs down)");
  return rating;
}

/**
 * ¿Coincide el usuario con la revisión interna? Se compara el sentido del voto (mayoría de 👍 frente a 👎) con el
 * veredicto interno: `bad` si alguna etiqueta humana es baja o algún score booleano es "false"; `good` si hay
 * veredicto y ninguno es malo. Sin veredicto interno o con votos empatados no hay comparación posible.
 */
export function feedbackAlignment(votes: Pick<UserFeedback, "rating">[], internal: { good: number; bad: number }): FeedbackAlignment {
  const up = votes.filter((v) => v.rating === 1).length;
  const down = votes.length - up;
  if (up === down || internal.good + internal.bad === 0) return "unknown";
  const userPositive = up > down;
  const internalPositive = internal.bad === 0;
  return userPositive === internalPositive ? "aligned" : "misaligned";
}
