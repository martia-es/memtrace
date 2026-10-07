import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import type { FeedbackDay, FeedbackRating, FeedbackSummary, UserFeedback } from "@/domain/user-feedback";
import { QueryLimiter } from "./query-limiter";

interface FeedbackRow {
  ServiceName: string;
  TraceId: string;
  SpanId: string;
  EndUserId: string;
  Rating: number;
  Comment: string | null;
  ExternalMessageId: string;
  CreatedAt: string;
  IsDeleted: number;
}

const FEEDBACK_ROW_LIMIT = 5000;

/**
 * Implementación del puerto sobre la tabla `user_feedback` (ADR-062). Toda lectura usa `FINAL` + `IsDeleted = 0`:
 * ReplacingMergeTree deduplica por clave solo al fusionar.
 */
export class ClickHouseUserFeedbackRepository implements UserFeedbackRepository {
  private readonly limiter: QueryLimiter;

  constructor(
    private readonly writeClient: ClickHouseClient,
    private readonly readClient: ClickHouseClient,
    private readonly database: string,
    maxConcurrentQueries = 3,
  ) {
    this.limiter = new QueryLimiter(maxConcurrentQueries);
  }

  upsert(serviceName: string, feedback: UserFeedback): Promise<void> {
    return this.insert(serviceName, feedback, 0);
  }

  retract(serviceName: string, feedback: UserFeedback): Promise<void> {
    return this.insert(serviceName, feedback, 1);
  }

  listForTrace(serviceName: string, traceId: string): Promise<UserFeedback[]> {
    return this.select("TraceId = {traceId:String}", { serviceName, traceId }, "CreatedAt ASC", 1000);
  }

  listForTraces(serviceName: string, traceIds: string[]): Promise<UserFeedback[]> {
    if (traceIds.length === 0) return Promise.resolve([]);
    return this.select("TraceId IN {traceIds:Array(String)}", { serviceName, traceIds }, "CreatedAt ASC", FEEDBACK_ROW_LIMIT);
  }

  listRecent(serviceName: string, fromMs: number, toMs: number, limit: number, rating?: 1 | -1): Promise<UserFeedback[]> {
    return this.select(
      `${RANGE} ${rating === undefined ? "" : "AND Rating = {rating:Int8}"}`,
      { serviceName, fromMs, toMs, limit, ...(rating === undefined ? {} : { rating }) },
      "CreatedAt DESC",
      limit,
    );
  }

  async summarize(serviceName: string, fromMs: number, toMs: number): Promise<FeedbackSummary> {
    const rows = await this.query<{ up: string; down: string; traces: string }>(
      `SELECT countIf(Rating = 1) AS up, countIf(Rating = -1) AS down, uniqExact(TraceId) AS traces
         FROM ${this.database}.user_feedback FINAL
        WHERE ServiceName = {serviceName:String} AND IsDeleted = 0 AND ${RANGE_BOUNDS}`,
      { serviceName, fromMs, toMs },
      "summary",
    );
    const up = Number(rows[0]?.up ?? 0);
    const down = Number(rows[0]?.down ?? 0);
    const total = up + down;
    return { total, up, down, satisfaction: total === 0 ? null : Math.round((up / total) * 1000) / 10, ratedTraces: Number(rows[0]?.traces ?? 0) };
  }

  async daily(serviceName: string, fromMs: number, toMs: number): Promise<FeedbackDay[]> {
    const rows = await this.query<{ day: string; up: string; down: string }>(
      `SELECT toString(toDate(CreatedAt, 'UTC')) AS day, countIf(Rating = 1) AS up, countIf(Rating = -1) AS down
         FROM ${this.database}.user_feedback FINAL
        WHERE ServiceName = {serviceName:String} AND IsDeleted = 0 AND ${RANGE_BOUNDS}
        GROUP BY day ORDER BY day ASC`,
      { serviceName, fromMs, toMs },
      "daily",
    );
    return rows.map((r) => ({ day: r.day, up: Number(r.up), down: Number(r.down) }));
  }

  private async select(condition: string, params: Record<string, unknown>, order: string, limit: number): Promise<UserFeedback[]> {
    const rows = await this.query<FeedbackRow>(
      `SELECT * FROM ${this.database}.user_feedback FINAL
        WHERE ServiceName = {serviceName:String} AND IsDeleted = 0 AND ${condition}
        ORDER BY ${order}
        LIMIT ${Math.min(Math.max(Math.trunc(limit), 1), FEEDBACK_ROW_LIMIT)}`,
      params,
      "feedback",
    );
    return rows.map(toFeedback);
  }

  private async query<T>(query: string, params: Record<string, unknown>, what: string): Promise<T[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.readClient.query({ query, query_params: params, format: "JSONEachRow" });
        return result.json<T>();
      });
    } catch (error) {
      console.error(`[memtrace-api] ClickHouse query (user ${what}) failed:`, error);
      throw new RepositoryUnavailableError(error);
    }
  }

  private async insert(serviceName: string, feedback: UserFeedback, isDeleted: 0 | 1): Promise<void> {
    const row: FeedbackRow = {
      ServiceName: serviceName,
      TraceId: feedback.traceId,
      SpanId: feedback.spanId ?? "",
      EndUserId: feedback.endUserId ?? "",
      Rating: feedback.rating,
      Comment: feedback.comment,
      ExternalMessageId: feedback.externalMessageId ?? "",
      // DateTime64 en JSONEachRow espera "YYYY-MM-DD HH:MM:SS.mmm", no el "T"/"Z" de toISOString()
      CreatedAt: feedback.createdAt.replace("T", " ").replace("Z", ""),
      IsDeleted: isDeleted,
    };
    try {
      await this.writeClient.insert({ table: `${this.database}.user_feedback`, values: [row], format: "JSONEachRow" });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse insert (user_feedback) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}

const RANGE_BOUNDS = "CreatedAt >= fromUnixTimestamp64Milli({fromMs:Int64}) AND CreatedAt < fromUnixTimestamp64Milli({toMs:Int64})";
const RANGE = RANGE_BOUNDS;

function toFeedback(row: FeedbackRow): UserFeedback {
  return {
    traceId: row.TraceId,
    spanId: row.SpanId === "" ? null : row.SpanId,
    rating: (row.Rating >= 1 ? 1 : -1) as FeedbackRating,
    comment: row.Comment,
    endUserId: row.EndUserId === "" ? null : row.EndUserId,
    externalMessageId: row.ExternalMessageId === "" ? null : row.ExternalMessageId,
    // ClickHouse devuelve "YYYY-MM-DD HH:MM:SS.mmm" sin zona (el servidor corre en UTC, igual que al insertar)
    createdAt: `${row.CreatedAt.replace(" ", "T")}Z`,
  };
}
