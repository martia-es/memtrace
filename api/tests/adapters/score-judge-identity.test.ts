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

  it("writes JudgeModel/JudgePromptHash columns on insert", async () => {
    let inserted: Array<Record<string, unknown>> = [];
    const writeClient = { insert: async (args: { values: Array<Record<string, unknown>> }) => void (inserted = args.values) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository(writeClient, {} as ClickHouseClient, "memtrace");
    const item: DatasetRunItemSubmission = { input: "q", expectedOutput: "a", output: "a", traceId: null, error: null, scores: [JUDGE_SCORE, { name: "exact_match", value: "true", dataType: "boolean", source: "code", comment: null }] };

    await repo.insertScores("svc", "run-1", [item]);

    expect(inserted[0]).toMatchObject({ Name: "correctness", JudgeModel: "judge-x", JudgePromptHash: "abc123" });
    expect(inserted[1]).toMatchObject({ Name: "exact_match", JudgeModel: null, JudgePromptHash: null });
  });

  it("reads the judge identity back per score", async () => {
    const row = { ServiceName: "svc", DatasetRunId: "run-1", ItemIndex: 0, TraceId: null, Name: "correctness", Value: "true", DataType: "boolean", Source: "llm_judge", Comment: null, JudgeModel: "judge-x", JudgePromptHash: "abc123", Input: '"q"', Output: null, ExpectedOutput: null, Error: null, CreatedAt: "2026-10-03 00:00:00.000" };
    const readClient = { query: async () => ({ json: async () => [row] }) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository({} as ClickHouseClient, readClient, "memtrace");

    const [item] = await repo.listScoresByRun("svc", "run-1");

    expect(item!.scores[0]).toMatchObject({ judgeModel: "judge-x", judgePromptHash: "abc123" });
  });

  it("aggregates the distinct judge identities of a run's llm_judge scores", async () => {
    const row = { DatasetRunId: "run-1", Name: "correctness", DataType: "boolean", total: "4", boolCount: "4", trueCount: "3", avgValue: null, judges: [["judge-x", "abc123"], [null, null]] };
    const readClient = { query: async () => ({ json: async () => [row] }) } as unknown as ClickHouseClient;
    const repo = new ClickHouseScoreRepository({} as ClickHouseClient, readClient, "memtrace");

    const [agg] = await repo.aggregateForRuns("svc", ["run-1"]);

    expect(agg!.judges).toEqual([{ model: "judge-x", promptHash: "abc123" }, { model: null, promptHash: null }]);
  });
});
