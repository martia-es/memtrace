import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { JudgeScoreRow, ScoreRepository } from "@/application/ports/score-repository";
import type { TraceScore } from "@/domain/annotation";
import type { DatasetRunItemResult, DatasetRunItemSubmission, Score, ScoreAggregate, ScoreDataType } from "@/domain/evaluation";

interface ScoreRow {
  ServiceName: string;
  DatasetRunId: string;
  ItemIndex: number;
  TraceId: string | null;
  Name: string;
  Value: string;
  DataType: string;
  Source: string;
  Comment: string | null;
  JudgeModel: string | null;
  JudgePromptHash: string | null;
  Input: string;
  Output: string | null;
  ExpectedOutput: string | null;
  Error: string | null;
  CreatedAt: string;
}

/** Implementación del puerto sobre la tabla `scores` (ADR-028). El cliente de escritura está
 * acotado exclusivamente a esta tabla (ver `client.ts::createEvaluationWriteClient`). */
export class ClickHouseScoreRepository implements ScoreRepository {
  constructor(
    private readonly writeClient: ClickHouseClient,
    private readonly readClient: ClickHouseClient,
    private readonly database: string,
  ) {}

  async insertScores(serviceName: string, datasetRunId: string, items: DatasetRunItemSubmission[], startIndex = 0): Promise<void> {
    // DateTime64 en JSONEachRow espera "YYYY-MM-DD HH:MM:SS.mmm", no el "T"/"Z" de toISOString()
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    const rows: ScoreRow[] = items.flatMap((item, itemIndex) =>
      // un item sin scores (p.ej. porque `task` lanzó una excepción) deja constancia de todos modos
      (item.scores.length > 0 ? item.scores : [placeholderScore(item)]).map((score) => ({
        ServiceName: serviceName,
        DatasetRunId: datasetRunId,
        ItemIndex: item.itemIndex ?? startIndex + itemIndex,
        TraceId: item.traceId,
        Name: score.name,
        Value: score.value,
        DataType: score.dataType,
        Source: score.source,
        Comment: score.comment,
        JudgeModel: score.judgeModel ?? null,
        JudgePromptHash: score.judgePromptHash ?? null,
        Input: JSON.stringify(item.input),
        Output: item.output === undefined ? null : JSON.stringify(item.output),
        ExpectedOutput: item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput),
        Error: item.error,
        CreatedAt: now,
      })),
    );
    if (rows.length === 0) return;

    try {
      await this.writeClient.insert({ table: `${this.database}.scores`, values: rows, format: "JSONEachRow" });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse insert (scores) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async listScoresByRun(serviceName: string, datasetRunId: string): Promise<DatasetRunItemResult[]> {
    let rows: ScoreRow[];
    try {
      const result = await this.readClient.query({
        query: `SELECT * FROM ${this.database}.scores FINAL
                 WHERE ServiceName = {serviceName:String} AND DatasetRunId = {datasetRunId:String}
                 ORDER BY ItemIndex ASC, Name ASC`,
        query_params: { serviceName, datasetRunId },
        format: "JSONEachRow",
      });
      rows = await result.json<ScoreRow>();
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (scores) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
    return groupByItem(rows);
  }

  async listScoresByTrace(serviceName: string, traceId: string): Promise<TraceScore[]> {
    try {
      // `scores` no tiene índice por TraceId (su clave empieza por DatasetRunId): es un escaneo acotado por ServiceName.
      // Si resultara lento, añadir un índice de salto bloom_filter en TraceId (ADR-037) en lugar de remodelar la tabla.
      const result = await this.readClient.query({
        query: `SELECT DatasetRunId, ItemIndex, Name, Value, DataType, Source, Comment
                  FROM ${this.database}.scores FINAL
                 WHERE ServiceName = {serviceName:String} AND TraceId = {traceId:String} AND Name != '_no_score'
                 ORDER BY CreatedAt ASC, Name ASC
                 LIMIT 500`,
        query_params: { serviceName, traceId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ DatasetRunId: string; ItemIndex: number; Name: string; Value: string; DataType: string; Source: string; Comment: string | null }>();
      return rows.map((r) => ({
        datasetRunId: r.DatasetRunId,
        itemIndex: r.ItemIndex,
        name: r.Name,
        value: r.Value,
        dataType: r.DataType as TraceScore["dataType"],
        source: r.Source,
        comment: r.Comment,
      }));
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (scores by trace) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async listJudgeScoresForRuns(serviceName: string, datasetRunIds: string[], name?: string): Promise<JudgeScoreRow[]> {
    if (datasetRunIds.length === 0) return [];
    try {
      const result = await this.readClient.query({
        query: `SELECT DatasetRunId, ItemIndex, Name, Value, DataType, JudgeModel, JudgePromptHash
                  FROM ${this.database}.scores FINAL
                 WHERE ServiceName = {serviceName:String}
                   AND DatasetRunId IN {datasetRunIds:Array(String)}
                   AND Source = 'llm_judge'
                   AND Name != '_no_score'
                   ${name === undefined ? "" : "AND Name = {name:String}"}
                 LIMIT 50000`,
        query_params: { serviceName, datasetRunIds, ...(name === undefined ? {} : { name }) },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ DatasetRunId: string; ItemIndex: number; Name: string; Value: string; DataType: string; JudgeModel: string | null; JudgePromptHash: string | null }>();
      return rows.map((r) => ({
        datasetRunId: r.DatasetRunId,
        itemIndex: r.ItemIndex,
        name: r.Name,
        value: r.Value,
        dataType: r.DataType as ScoreDataType,
        judgeModel: r.JudgeModel,
        judgePromptHash: r.JudgePromptHash,
      }));
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (judge scores) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async aggregateForRuns(serviceName: string, datasetRunIds: string[]): Promise<ScoreAggregate[]> {
    if (datasetRunIds.length === 0) return [];
    let rows: AggregateRow[];
    try {
      const result = await this.readClient.query({
        query: `SELECT
                   DatasetRunId, Name, DataType,
                   count() AS total,
                   countIf(DataType = 'boolean') AS boolCount,
                   countIf(DataType = 'boolean' AND Value = 'true') AS trueCount,
                   avgIf(toFloat64OrNull(Value), DataType = 'numeric') AS avgValue,
                   groupUniqArrayIf((JudgeModel, JudgePromptHash), Source = 'llm_judge') AS judges
                 FROM ${this.database}.scores FINAL
                 WHERE ServiceName = {serviceName:String}
                   AND DatasetRunId IN {datasetRunIds:Array(String)}
                   AND Name != '_no_score'
                 GROUP BY DatasetRunId, Name, DataType`,
        query_params: { serviceName, datasetRunIds },
        format: "JSONEachRow",
      });
      rows = await result.json<AggregateRow>();
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (score aggregates) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
    return rows.map(toScoreAggregate);
  }
}

interface AggregateRow {
  DatasetRunId: string;
  Name: string;
  DataType: string;
  // UInt64 llega como string en JSONEachRow, no como number
  total: string;
  boolCount: string;
  trueCount: string;
  avgValue: number | null;
  // tupla (Nullable(String), Nullable(String)) llega como array de 2 elementos en JSONEachRow
  judges: Array<[string | null, string | null]>;
}

function toScoreAggregate(row: AggregateRow): ScoreAggregate {
  const dataType = row.DataType as ScoreAggregate["dataType"];
  // UInt64 (count()/countIf()) llega como string en JSONEachRow para no perder precisión
  const total = Number(row.total);
  const boolCount = Number(row.boolCount);
  const trueCount = Number(row.trueCount);
  return {
    datasetRunId: row.DatasetRunId,
    name: row.Name,
    dataType,
    passRate: dataType === "boolean" && boolCount > 0 ? trueCount / boolCount : null,
    average: dataType === "numeric" ? row.avgValue : null,
    count: total,
    judges: row.judges.map(([model, promptHash]) => ({ model, promptHash })),
  };
}

/** Deja constancia de un item sin ningún evaluador aplicado (p. ej. `task` falló) con un score vacío. */
function placeholderScore(item: DatasetRunItemSubmission): Score {
  return { name: "_no_score", value: "", dataType: "categorical", source: "code", comment: item.error };
}

function groupByItem(rows: ScoreRow[]): DatasetRunItemResult[] {
  const byIndex = new Map<number, DatasetRunItemResult>();
  for (const row of rows) {
    let item = byIndex.get(row.ItemIndex);
    if (!item) {
      item = {
        itemIndex: row.ItemIndex,
        input: safeParse(row.Input),
        output: row.Output === null ? null : safeParse(row.Output),
        expectedOutput: row.ExpectedOutput === null ? null : safeParse(row.ExpectedOutput),
        traceId: row.TraceId,
        error: row.Error,
        scores: [],
      };
      byIndex.set(row.ItemIndex, item);
    }
    if (row.Name !== "_no_score") {
      item.scores.push({
        name: row.Name,
        value: row.Value,
        dataType: row.DataType as Score["dataType"],
        source: row.Source as Score["source"],
        comment: row.Comment,
        judgeModel: row.JudgeModel,
        judgePromptHash: row.JudgePromptHash,
      });
    }
  }
  return [...byIndex.values()].sort((a, b) => a.itemIndex - b.itemIndex);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
