import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { JudgeScoreRow, ScoreRepository } from "@/application/ports/score-repository";
import type { TraceScore } from "@/domain/annotation";
import type { DatasetRunItemResult, DatasetRunItemSubmission, Score, ScoreAggregate, ScoreDataType } from "@/domain/evaluation";

interface ItemRow {
  ServiceName: string;
  DatasetRunId: string;
  ItemIndex: number;
  TraceId: string | null;
  Input: string;
  Output: string | null;
  ExpectedOutput: string | null;
  Error: string | null;
  CreatedAt: string;
}

interface ScoreRow {
  ServiceName: string;
  DatasetRunId: string;
  ItemIndex: number;
  Name: string;
  Value: string;
  ValueNum: number | null;
  DataType: string;
  Source: string;
  Comment: string | null;
  JudgeModel: string | null;
  JudgePromptHash: string | null;
  CreatedAt: string;
}

/** Valor tipado de un score: el número de un `numeric`, 1/0 de un `boolean`, null en un `categorical` (o si no es un número finito). */
export function numericValueOf(score: Pick<Score, "value" | "dataType">): number | null {
  if (score.dataType === "boolean") return score.value === "true" ? 1 : score.value === "false" ? 0 : null;
  if (score.dataType === "numeric") {
    const n = Number(score.value);
    return score.value.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Implementación del puerto sobre `eval_items` + `eval_scores` (ADR-044). El cliente de escritura está
 * acotado exclusivamente a las tablas de evaluación (ver `client.ts::createEvaluationWriteClient`). */
export class ClickHouseScoreRepository implements ScoreRepository {
  constructor(
    private readonly writeClient: ClickHouseClient,
    private readonly readClient: ClickHouseClient,
    private readonly database: string,
  ) {}

  async insertScores(serviceName: string, datasetRunId: string, items: DatasetRunItemSubmission[], startIndex = 0): Promise<void> {
    // DateTime64 en JSONEachRow espera "YYYY-MM-DD HH:MM:SS.mmm", no el "T"/"Z" de toISOString()
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    const indexed = items.map((item, position) => ({ item, itemIndex: item.itemIndex ?? startIndex + position }));
    // un item sin scores (p.ej. porque `task` lanzó una excepción) queda igualmente en eval_items
    const itemRows: ItemRow[] = indexed.map(({ item, itemIndex }) => ({
      ServiceName: serviceName,
      DatasetRunId: datasetRunId,
      ItemIndex: itemIndex,
      TraceId: item.traceId,
      Input: JSON.stringify(item.input),
      Output: item.output === undefined ? null : JSON.stringify(item.output),
      ExpectedOutput: item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput),
      Error: item.error,
      CreatedAt: now,
    }));
    const scoreRows: ScoreRow[] = indexed.flatMap(({ item, itemIndex }) =>
      item.scores.map((score) => ({
        ServiceName: serviceName,
        DatasetRunId: datasetRunId,
        ItemIndex: itemIndex,
        Name: score.name,
        Value: score.value,
        ValueNum: numericValueOf(score),
        DataType: score.dataType,
        Source: score.source,
        Comment: score.comment,
        JudgeModel: score.judgeModel ?? null,
        JudgePromptHash: score.judgePromptHash ?? null,
        CreatedAt: now,
      })),
    );
    if (itemRows.length === 0) return;

    try {
      await this.writeClient.insert({ table: `${this.database}.eval_items`, values: itemRows, format: "JSONEachRow" });
      if (scoreRows.length > 0) await this.writeClient.insert({ table: `${this.database}.eval_scores`, values: scoreRows, format: "JSONEachRow" });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse insert (eval items/scores) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async listScoresByRun(serviceName: string, datasetRunId: string): Promise<DatasetRunItemResult[]> {
    try {
      const params = { serviceName, datasetRunId };
      const [items, scores] = await Promise.all([
        this.readClient.query({
          query: `SELECT * FROM ${this.database}.eval_items FINAL
                   WHERE ServiceName = {serviceName:String} AND DatasetRunId = {datasetRunId:String}
                   ORDER BY ItemIndex ASC`,
          query_params: params,
          format: "JSONEachRow",
        }),
        this.readClient.query({
          query: `SELECT * FROM ${this.database}.eval_scores FINAL
                   WHERE ServiceName = {serviceName:String} AND DatasetRunId = {datasetRunId:String}
                   ORDER BY ItemIndex ASC, Name ASC`,
          query_params: params,
          format: "JSONEachRow",
        }),
      ]);
      return joinItems(await items.json<ItemRow>(), await scores.json<ScoreRow>());
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (eval items/scores) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async listScoresByTraces(serviceName: string, traceIds: string[]): Promise<Array<TraceScore & { traceId: string }>> {
    if (traceIds.length === 0) return [];
    try {
      const result = await this.readClient.query({
        query: `SELECT i.TraceId AS TraceId, s.DatasetRunId AS DatasetRunId, s.ItemIndex AS ItemIndex, s.Name AS Name, s.Value AS Value, s.DataType AS DataType, s.Source AS Source, s.Comment AS Comment
                  FROM ${this.database}.eval_scores AS s FINAL
                 INNER JOIN (
                   SELECT DatasetRunId, ItemIndex, assumeNotNull(TraceId) AS TraceId FROM ${this.database}.eval_items FINAL
                    WHERE ServiceName = {serviceName:String} AND TraceId IN {traceIds:Array(String)}
                 ) AS i ON s.DatasetRunId = i.DatasetRunId AND s.ItemIndex = i.ItemIndex
                 WHERE s.ServiceName = {serviceName:String}
                 ORDER BY s.CreatedAt ASC, s.Name ASC
                 LIMIT 5000`,
        query_params: { serviceName, traceIds },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string; DatasetRunId: string; ItemIndex: number; Name: string; Value: string; DataType: string; Source: string; Comment: string | null }>();
      return rows.map((r) => ({
        traceId: r.TraceId,
        datasetRunId: r.DatasetRunId,
        itemIndex: r.ItemIndex,
        name: r.Name,
        value: r.Value,
        dataType: r.DataType as TraceScore["dataType"],
        source: r.Source,
        comment: r.Comment,
      }));
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (scores by traces) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async listScoresByTrace(serviceName: string, traceId: string): Promise<TraceScore[]> {
    try {
      // eval_items tiene un índice de salto bloom_filter en TraceId; los scores se buscan por (run, item) de esos items.
      const result = await this.readClient.query({
        query: `SELECT s.DatasetRunId AS DatasetRunId, s.ItemIndex AS ItemIndex, s.Name AS Name, s.Value AS Value, s.DataType AS DataType, s.Source AS Source, s.Comment AS Comment
                  FROM ${this.database}.eval_scores AS s FINAL
                 INNER JOIN (
                   SELECT DatasetRunId, ItemIndex FROM ${this.database}.eval_items FINAL
                    WHERE ServiceName = {serviceName:String} AND TraceId = {traceId:String}
                 ) AS i ON s.DatasetRunId = i.DatasetRunId AND s.ItemIndex = i.ItemIndex
                 WHERE s.ServiceName = {serviceName:String}
                 ORDER BY s.CreatedAt ASC, s.Name ASC
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
                  FROM ${this.database}.eval_scores FINAL
                 WHERE ServiceName = {serviceName:String}
                   AND DatasetRunId IN {datasetRunIds:Array(String)}
                   AND Source = 'llm_judge'
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
    try {
      // Los runs completos ya tienen su resumen (ADR-045); solo el resto (en curso, o cerrados antes del resumen) se calcula sobre eval_scores.
      const summaries = await this.readSummaries(serviceName, datasetRunIds);
      const summarized = new Set(summaries.map((a) => a.datasetRunId));
      const pending = datasetRunIds.filter((id) => !summarized.has(id));
      return [...summaries, ...(await this.computeAggregates(serviceName, pending))];
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (score aggregates) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  async materializeRunSummary(serviceName: string, datasetRunId: string): Promise<void> {
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");
    try {
      // Se lee con el cliente de lectura y se inserta con el de escritura: `api_writer` solo puede INSERT (ADR-045).
      const aggregates = await this.computeAggregates(serviceName, [datasetRunId]);
      if (aggregates.length === 0) return;
      await this.writeClient.insert({
        table: `${this.database}.eval_run_summaries`,
        values: aggregates.map((a) => ({
          ServiceName: serviceName,
          DatasetRunId: a.datasetRunId,
          Name: a.name,
          DataType: a.dataType,
          Total: a.count,
          AvgValue: a.dataType === "boolean" ? a.passRate : a.average,
          Judges: a.judges.map((j) => [j.model, j.promptHash]),
          CreatedAt: now,
        })),
        format: "JSONEachRow",
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse write (run summary) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  private async readSummaries(serviceName: string, datasetRunIds: string[]): Promise<ScoreAggregate[]> {
    const result = await this.readClient.query({
      query: `SELECT DatasetRunId, Name, DataType, Total AS total, AvgValue AS avgValue, Judges AS judges
                FROM ${this.database}.eval_run_summaries FINAL
               WHERE ServiceName = {serviceName:String} AND DatasetRunId IN {datasetRunIds:Array(String)}`,
      query_params: { serviceName, datasetRunIds },
      format: "JSONEachRow",
    });
    return (await result.json<AggregateRow>()).map(toScoreAggregate);
  }

  private async computeAggregates(serviceName: string, datasetRunIds: string[]): Promise<ScoreAggregate[]> {
    if (datasetRunIds.length === 0) return [];
    // ValueNum es la columna tipada (ADR-044): ya no hay que parsear `Value` en cada agregación.
    const result = await this.readClient.query({
      query: `SELECT
                 DatasetRunId, Name, DataType,
                 count() AS total,
                 avgIf(ValueNum, DataType IN ('boolean', 'numeric')) AS avgValue,
                 groupUniqArrayIf((JudgeModel, JudgePromptHash), Source = 'llm_judge') AS judges
               FROM ${this.database}.eval_scores FINAL
               WHERE ServiceName = {serviceName:String}
                 AND DatasetRunId IN {datasetRunIds:Array(String)}
               GROUP BY DatasetRunId, Name, DataType`,
      query_params: { serviceName, datasetRunIds },
      format: "JSONEachRow",
    });
    return (await result.json<AggregateRow>()).map(toScoreAggregate);
  }
}

interface AggregateRow {
  DatasetRunId: string;
  Name: string;
  DataType: string;
  // UInt64 llega como string en JSONEachRow, no como number
  total: string;
  // media de ValueNum: para un boolean es la tasa de aprobados (1/0); null si no hay valores numéricos
  avgValue: number | null;
  // tupla (Nullable(String), Nullable(String)) llega como array de 2 elementos en JSONEachRow
  judges: Array<[string | null, string | null]>;
}

function toScoreAggregate(row: AggregateRow): ScoreAggregate {
  const dataType = row.DataType as ScoreAggregate["dataType"];
  return {
    datasetRunId: row.DatasetRunId,
    name: row.Name,
    dataType,
    passRate: dataType === "boolean" ? row.avgValue : null,
    average: dataType === "numeric" ? row.avgValue : null,
    count: Number(row.total),
    judges: row.judges.map(([model, promptHash]) => ({ model, promptHash })),
  };
}

/** Une los items de un run con sus scores. Un item sin scores (p. ej. `task` falló) sale con `scores: []`. */
function joinItems(items: ItemRow[], scores: ScoreRow[]): DatasetRunItemResult[] {
  const scoresByIndex = new Map<number, Score[]>();
  for (const row of scores) {
    const list = scoresByIndex.get(row.ItemIndex) ?? [];
    list.push({
      name: row.Name,
      value: row.Value,
      dataType: row.DataType as Score["dataType"],
      source: row.Source as Score["source"],
      comment: row.Comment,
      judgeModel: row.JudgeModel,
      judgePromptHash: row.JudgePromptHash,
    });
    scoresByIndex.set(row.ItemIndex, list);
  }
  return items
    .map((row) => ({
      itemIndex: row.ItemIndex,
      input: safeParse(row.Input),
      output: row.Output === null ? null : safeParse(row.Output),
      expectedOutput: row.ExpectedOutput === null ? null : safeParse(row.ExpectedOutput),
      traceId: row.TraceId,
      error: row.Error,
      scores: scoresByIndex.get(row.ItemIndex) ?? [],
    }))
    .sort((a, b) => a.itemIndex - b.itemIndex);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
