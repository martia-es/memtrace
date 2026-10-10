import { HttpClient, type HttpOptions } from "./http/client.js";

export type Rating = "up" | "down" | 1 | -1;
const RATINGS = new Map<Rating, 1 | -1>([["up", 1], ["down", -1], [1, 1], [-1, -1]]);

export interface FeedbackOptions extends HttpOptions {
  comment?: string;
  spanId?: string;
  /** A pseudonym you choose: the same person voting again on the same answer replaces their vote. */
  endUserId?: string;
  /** Your own message id, kept as metadata. */
  externalMessageId?: string;
}

/** Records (or changes) an end user's vote on the answer of `traceId` (ADR-062). Rejects if MemTrace refuses it. */
export async function feedback(traceId: string, rating: Rating, options: FeedbackOptions = {}): Promise<void> {
  const value = RATINGS.get(rating);
  if (value === undefined) throw new Error("rating must be 'up', 'down', 1 or -1");
  const body: Record<string, unknown> = { rating: value };
  const optional = { comment: options.comment, spanId: options.spanId, endUserId: options.endUserId, externalMessageId: options.externalMessageId };
  for (const [key, v] of Object.entries(optional)) if (v !== undefined) body[key] = v;
  await new HttpClient(options).request("POST", `/traces/${traceId}/feedback`, { json: body });
}

/** Withdraws an end user's vote (the one for `endUserId`, or the anonymous one). Idempotent. */
export async function retractFeedback(traceId: string, options: Pick<FeedbackOptions, "spanId" | "endUserId"> & HttpOptions = {}): Promise<void> {
  await new HttpClient(options).request("DELETE", `/traces/${traceId}/feedback`, { query: { endUserId: options.endUserId, spanId: options.spanId } });
}
