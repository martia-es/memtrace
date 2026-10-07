import type { FeedbackDay, FeedbackSummary, UserFeedback } from "@/domain/user-feedback";

/** Puerto hacia el almacén de feedback de usuario final (ClickHouse, ADR-062). Una fila por (traza, span, usuario final). */
export interface UserFeedbackRepository {
  /** Inserta (o sustituye, si ya existía la misma clave) el voto. `createdAt` lo fija el llamador (reloj del servidor). */
  upsert(serviceName: string, feedback: UserFeedback): Promise<void>;
  /** Inserta la lápida de un voto (misma clave, `IsDeleted = 1`, `createdAt` posterior). */
  retract(serviceName: string, feedback: UserFeedback): Promise<void>;
  /** Votos vigentes de una traza, de todos los usuarios finales. */
  listForTrace(serviceName: string, traceId: string): Promise<UserFeedback[]>;
  /** Votos vigentes de esas trazas (para las columnas de las listas). */
  listForTraces(serviceName: string, traceIds: string[]): Promise<UserFeedback[]>;
  /** Totales de votos creados en el rango. */
  summarize(serviceName: string, fromMs: number, toMs: number): Promise<FeedbackSummary>;
  /** Votos por día (UTC) en el rango. */
  daily(serviceName: string, fromMs: number, toMs: number): Promise<FeedbackDay[]>;
  /** Votos vigentes del rango, los más recientes primero, hasta `limit`; `rating` filtra por sentido. */
  listRecent(serviceName: string, fromMs: number, toMs: number, limit: number, rating?: 1 | -1): Promise<UserFeedback[]>;
}
