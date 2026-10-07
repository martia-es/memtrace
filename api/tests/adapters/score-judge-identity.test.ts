import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { submitDatasetRunBody } from "@/adapters/inbound/http/schemas";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import type { DatasetRunItemSubmission } from "@/domain/evaluation";

const JUDGE_SCORE = { name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: "ok", judgeModel: "judge-x", judgePromptHash: "abc123" } as const;

describe("judge identity on scores (ADR-043)", () => {
  it("accepts judgeModel/judgePromptHash and defaults them to null for older SDKs", () => {
    const parsed = submitDatasetRunBody.parse({
      name: "r",
      datasetVersion: "1.0",
      items: [{ input: "q", scores: [JUDGE_SCORE, { name: "exact_match", value: "true", dataType: "boolean", source: "code" }] }],
    });
    const [judge, code] = parsed.items[0]!.scores;
    expect(judge).toMatchObject({ judgeModel: "judge-x", judgePromptHash: "abc123" });
    expect(code).toMatchObject({ judgeModel: null, judgePromptHash: null });
  });

  it("accepts the evaluated commit on a run and defaults it to null (ADR-065)", () => {
    const body = { name: "r", datasetVersion: "1.0", items: [{ input: "q", scores: [] }] };
    expect(submitDatasetRunBody.parse(body).revision).toBeNull();
    expect(submitDatasetRunBody.parse({ ...body, revision: { sha: "a".repeat(40) } }).revision).toEqual({ sha: "a".repeat(40), dirty: null });
    expect(() => submitDatasetRunBody.parse({ ...body, revision: { sha: "not-a-sha" } })).toThrow();
  });

  it("writes JudgeModel/JudgePromptHash and the typed ValueNum on eval_scores, and the item text once on eval_items", async () => {
    const inserted: Record<string, Array<Record<string, unknown>>> = {};
    const writeClient = { insert: async (args: { table: string; values: Array<Record<string, unknown>> }) => void (inserted[args.table] = args.values) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository(writeClient, {} as ClickHouseClient, "memtrace");
    const item: DatasetRunItemSubmission = {
      input: "q",
      expectedOutput: "a",
      output: "a",
      traceId: "t1",
      error: null,
      scores: [JUDGE_SCORE, { name: "exact_match", value: "true", dataType: "boolean", source: "code", comment: null }, { name: "similarity", value: "0.75", dataType: "numeric", source: "code", comment: null }, { name: "tone", value: "polite", dataType: "categorical", source: "code", comment: null }],
    };

    await repo.insertScores("svc", "run-1", [item]);

    expect(inserted["memtrace.eval_items"]).toHaveLength(1);
    expect(inserted["memtrace.eval_items"]![0]).toMatchObject({ DatasetRunId: "run-1", ItemIndex: 0, TraceId: "t1", Input: '"q"', Output: '"a"' });
    const scores = inserted["memtrace.eval_scores"]!;
    expect(scores).toHaveLength(4);
    expect(scores[0]).toMatchObject({ Name: "correctness", JudgeModel: "judge-x", JudgePromptHash: "abc123", ValueNum: 1 });
    expect(scores[1]).toMatchObject({ Name: "exact_match", JudgeModel: null, JudgePromptHash: null, ValueNum: 1 });
    expect(scores[2]).toMatchObject({ Name: "similarity", Value: "0.75", ValueNum: 0.75 });
    expect(scores[3]).toMatchObject({ Name: "tone", ValueNum: null });
    expect(scores.every((r) => !("Input" in r) && !("Output" in r))).toBe(true);
  });

  it("stores an item without scores (task failed) in eval_items only, with no placeholder row", async () => {
    const inserted: Record<string, unknown[]> = {};
    const writeClient = { insert: async (args: { table: string; values: unknown[] }) => void (inserted[args.table] = args.values) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository(writeClient, {} as ClickHouseClient, "memtrace");

    await repo.insertScores("svc", "run-1", [{ input: "q", expectedOutput: null, output: undefined, traceId: null, error: "boom", scores: [] }]);

    expect(inserted["memtrace.eval_items"]).toHaveLength(1);
    expect(inserted["memtrace.eval_scores"]).toBeUndefined();
  });

  it("reads the judge identity back per score and joins scores to their item", async () => {
    const item = { ServiceName: "svc", DatasetRunId: "run-1", ItemIndex: 0, TraceId: null, Input: '"q"', Output: null, ExpectedOutput: null, Error: null, CreatedAt: "2026-10-03 00:00:00.000" };
    const score = { ServiceName: "svc", DatasetRunId: "run-1", ItemIndex: 0, Name: "correctness", Value: "true", ValueNum: 1, DataType: "boolean", Source: "llm_judge", Comment: null, JudgeModel: "judge-x", JudgePromptHash: "abc123", CreatedAt: "2026-10-03 00:00:00.000" };
    const failedItem = { ...item, ItemIndex: 1, Error: "boom" };
    const readClient = { query: async ({ query }: { query: string }) => ({ json: async () => (query.includes("eval_items") ? [item, failedItem] : [score]) }) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository({} as ClickHouseClient, readClient, "memtrace");

    const items = await repo.listScoresByRun("svc", "run-1");

    expect(items[0]!.scores[0]).toMatchObject({ judgeModel: "judge-x", judgePromptHash: "abc123" });
    expect(items[1]).toMatchObject({ itemIndex: 1, error: "boom", scores: [] });
  });

  it("aggregates the distinct judge identities of a run's llm_judge scores, with the pass rate from the typed column", async () => {
    const row = { DatasetRunId: "run-1", Name: "correctness", DataType: "boolean", total: "4", avgValue: 0.75, judges: [["judge-x", "abc123"], [null, null]] };
    const readClient = { query: async () => ({ json: async () => [row] }) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository({} as ClickHouseClient, readClient, "memtrace");

    const [agg] = await repo.aggregateForRuns("svc", ["run-1"]);

    expect(agg).toMatchObject({ passRate: 0.75, average: null, count: 4 });
    expect(agg!.judges).toEqual([{ model: "judge-x", promptHash: "abc123" }, { model: null, promptHash: null }]);
  });
});
