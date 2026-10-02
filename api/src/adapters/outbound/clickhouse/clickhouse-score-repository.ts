import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemResult, DatasetRunItemSubmission, Score, ScoreAggregate } from "@/domain/evaluation";

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
  Input: string;
  Output: string | null;
  ExpectedOutput: string | null;
  Error: string | null;
  CreatedAt: string;
}

/** Implementación del puerto sobre la tabla `scores` (ADR-028). El cliente de escritura está
 * acotado exclusivamente a esta tabla (ver `client.ts::createScoresWriteClient`). */
export class ClickHouseScoreRepository implements ScoreRepository {
  constructor(
    private readonly writeClient: ClickHouseClient,
    private readonly readClient: ClickHouseClient,
    private readonly database: string,
  ) {}

  async insertScores(serviceName: string, datasetRunId: string, items: DatasetRunItemSubmission[]): Promise<void> {
    // DateTime64 en JSONEachRow espera "YYYY-MM-DD HH:MM:SS.mmm", no el "T"/"Z" de toISOString()
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    const rows: ScoreRow[] = items.flatMap((item, itemIndex) =>
      // un item sin scores (p.ej. porque `task` lanzó una excepción) deja constancia de todos modos
      (item.scores.length > 0 ? item.scores : [placeholderScore(item)]).map((score) => ({
        ServiceName: serviceName,
        DatasetRunId: datasetRunId,
        ItemIndex: itemIndex,
        TraceId: item.traceId,
        Name: score.name,
        Value: score.value,
        DataType: score.dataType,
        Source: score.source,
        Comment: score.comment,
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
                   avgIf(toFloat64OrNull(Value), DataType = 'numeric') AS avgValue
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
      item.scores.push({ name: row.Name, value: row.Value, dataType: row.DataType as Score["dataType"], source: row.Source as Score["source"], comment: row.Comment });
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
