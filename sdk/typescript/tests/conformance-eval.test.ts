/** The `eval/` scenarios of sdk/conformance/ (ADR-095): pure scoring behaviour that must match the Python SDK. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Correctness, Faithfulness, HitRate, MRR, RecallAtK, type LLMClient } from "../src/index.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance", "eval");
const load = (name: string) => JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));

const client = (spec: { model: string; reply: string; replyModel?: string }): LLMClient => ({
  model: spec.model,
  complete: async () => (spec.replyModel ? { text: spec.reply, model: spec.replyModel } : spec.reply),
});
const judgeOf = (name: string, c: LLMClient) => (name === "faithfulness" ? new Faithfulness({ client: c }) : new Correctness({ client: c }));

describe("eval scenarios", () => {
  it("judge prompt hashes match the Python SDK's", () => {
    for (const [name, expected] of Object.entries(load("judge-prompt-hash").hashes as Record<string, string>)) {
      expect(judgeOf(name, client({ model: "m", reply: "" })).promptHash(), name).toBe(expected);
    }
  });

  it("retrieval metrics", async () => {
    for (const c of load("retrieval-metrics").cases) {
      const scores = [];
      for (const evaluator of [RecallAtK(2), RecallAtK(3), MRR(), HitRate()]) {
        const result = await evaluator({ input: "q", output: "a", metadata: c.metadata, retrievedChunks: c.retrieved });
        scores.push(...(Array.isArray(result) ? result : [result]));
      }
      expect(scores.map((s) => ({ name: s.name, value: s.value, dataType: s.dataType }))).toEqual(c.expect);
    }
  });

  it("judge scores", async () => {
    const scenario = load("judge-score");
    for (const c of scenario.cases) {
      const judge = judgeOf(scenario.judge, client(c.client));
      const args = { input: scenario.item.input, output: scenario.item.output, expectedOutput: scenario.item.expectedOutput, retrievedChunks: [] };
      if (c.expectError) { await expect(judge.evaluate(args)).rejects.toThrow("non-JSON"); continue; }
      const score = await judge.evaluate(args);
      expect(score).toMatchObject({ ...c.expect, source: "llm_judge" });
    }
  });
});
