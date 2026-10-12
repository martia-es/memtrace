import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExperimentResult, Faithfulness, MemTraceResultsSink, RepeatedExperimentResult, flush, ResultsUploadError, contains, evaluator, exactMatch, initTracer, recordRetrievedChunks, runExperiment,
  shutdown, withStep, MRR, type IncrementalResultsSink,
} from "../src/index.js";
import { FixProposalError, suggestFix } from "../src/prompts/fix.js";

afterEach(async () => { await shutdown(); });

const agent = (item: { input: unknown }) => `echo ${item.input}`;

describe("runExperiment", () => {
  it("scores every item, aggregates locally and keeps the order of the dataset", async () => {
    const result = await runExperiment({
      data: [{ input: "a", expectedOutput: "echo a" }, { input: "b", expected_output: "nope" }, { input: "c", expectedOutput: "echo c" }],
      task: agent, evaluators: [exactMatch, contains], name: "smoke", sink: null,
    });
    expect(result.items.map((r) => r.output)).toEqual(["echo a", "echo b", "echo c"]);
    expect(result.summary().find((s) => s.name === "exact_match")).toMatchObject({ count: 3, passRate: 2 / 3 });
    expect(result.datasetVersion).toBeUndefined();
  });

  it("a task that throws fails only its item; an evaluator that throws fails only its score", async () => {
    const boom = evaluator("boom", () => { throw new Error("bad evaluator"); });
    const result = await runExperiment({
      data: [{ input: "ok" }, { input: "fail" }],
      task: (item) => { if (item.input === "fail") throw new Error("agent exploded"); return "fine"; },
      evaluators: [boom], name: "x", sink: null,
    });
    expect(result.items[1]).toMatchObject({ error: "agent exploded", scores: [] });
    expect(result.errorCount).toBe(1);
    expect(result.items[0]!.scores[0]).toMatchObject({ name: "boom", dataType: "categorical", comment: "evaluator raised", value: "bad evaluator" });
  });

  it("respects maxWorkers", async () => {
    let running = 0, peak = 0;
    await runExperiment({
      data: Array.from({ length: 8 }, (_, i) => ({ input: i })), evaluators: [], name: "x", sink: null, maxWorkers: 2,
      task: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return 1; },
    });
    expect(peak).toBe(2);
  });

  it("reads a .jsonl file and fingerprints its content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memtrace-eval-"));
    try {
      const file = join(dir, "d.jsonl");
      writeFileSync(file, '{"input": "a", "expected_output": "echo a"}\n\n{"input": "b"}\n');
      const first = await runExperiment({ data: file, task: agent, evaluators: [exactMatch], name: "x", sink: null });
      expect(first.items).toHaveLength(2);
      expect(first.datasetVersion).toMatch(/^sha256:[0-9a-f]{12}$/);
      writeFileSync(file, '{"input": "a"}\n');
      expect((await runExperiment({ data: file, task: agent, evaluators: [], name: "x", sink: null })).datasetVersion).not.toBe(first.datasetVersion);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("feeds retrieved chunks to the retrieval metrics and opens one eval.item trace per item", async () => {
    const exporter = new InMemorySpanExporter();
    initTracer({ serviceName: "t", spanExporter: exporter });
    const result = await runExperiment({
      data: [{ input: "q", metadata: { relevant_docs: ["d1"] } }],
      task: () => withStep("retrieve", "retriever", () => { recordRetrievedChunks([{ id: "d1", text: "x" }]); return "answer"; }),
      evaluators: [MRR()], name: "rag", sink: null,
    });
    expect(result.items[0]!.scores).toEqual([{ name: "mrr", value: 1, dataType: "numeric" }]);
    expect(result.items[0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
    await flush();
    const spans = exporter.getFinishedSpans();
    expect(spans.find((s) => s.name === "eval.item")).toBeDefined();
    expect(spans.find((s) => s.name === "retrieve")!.attributes["memtrace.retriever.documents"]).toBe(1);
  });

  it("uploads to a MemTrace dataset by default, in batches, recording the version it read", async () => {
    const requests: Array<{ path: string; body: any }> = [];
    const fetchStub = (async (url: URL, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ path: url.pathname, body });
      if (init.method === "GET") return new Response(JSON.stringify({ version: { major: 2, minor: 1 }, items: [{ input: "q1", expectedOutput: "echo q1" }, { input: "q2" }, { input: "q3" }] }));
      return new Response(JSON.stringify({ id: "run-1" }), { status: 201 });
    }) as unknown as typeof fetch;
    const result = await runExperiment({
      data: { datasetId: "ds-1" }, task: agent, evaluators: [exactMatch], name: "v2", baseUrl: "http://m.test", apiKey: "k", fetch: fetchStub,
    });
    expect(result.datasetVersion).toBe("2.1");
    expect(requests[1]).toMatchObject({ path: "/datasets/ds-1/runs", body: { name: "v2", datasetVersion: "2.1", complete: false } });
    const uploaded = requests.slice(2).flatMap((r) => r.body.items.map((i: any) => i.itemIndex)).sort();
    expect(uploaded).toEqual([0, 1, 2]);
    expect(requests.at(-1)!.body.complete).toBe(true);
  });

  it("refuses to open a run without a dataset version, before spending an agent call", async () => {
    let calls = 0;
    const sink = new MemTraceResultsSink("ds-1", { baseUrl: "http://m.test", fetch: (async () => new Response("{}")) as unknown as typeof fetch });
    await expect(runExperiment({ data: [{ input: "a" }], task: () => { calls++; return 1; }, evaluators: [], name: "x", sink })).rejects.toThrow("major.minor");
    expect(calls).toBe(0);
  });

  it("keeps the whole result inside ResultsUploadError when saving fails", async () => {
    const sink: IncrementalResultsSink = { start: () => {}, add: () => {}, finish: () => { throw new Error("503"); } };
    const error = await runExperiment({ data: [{ input: "a" }], task: agent, evaluators: [], name: "x", sink }).catch((e) => e);
    expect(error).toBeInstanceOf(ResultsUploadError);
    expect(error.result.items).toHaveLength(1);
  });
});

describe("runExperiment repeats (ADR-097)", () => {
  const rows = [{ input: "a", expectedOutput: "echo a" }, { input: "b", expectedOutput: "echo b" }];

  it("defaults to one execution and returns a plain result", async () => {
    const result = await runExperiment({ data: rows, task: agent, evaluators: [exactMatch], name: "once", sink: null });
    expect(result).toBeInstanceOf(ExperimentResult);
    expect(result.repeat).toBeUndefined();
  });

  it("runs the whole experiment N times, reading the data once, and groups the executions", async () => {
    let fetches = 0;
    const source = { fetch: () => { fetches++; return rows; } };
    let calls = 0;
    const result = await runExperiment({ data: source, task: (i) => { calls++; return agent(i); }, evaluators: [exactMatch], name: "noisy", sink: null, repeats: 3 });
    expect(result).toBeInstanceOf(RepeatedExperimentResult);
    expect(fetches).toBe(1);
    expect(calls).toBe(3 * rows.length);
    expect(result.executions.map((e) => e.repeat?.index)).toEqual([1, 2, 3]);
    expect(new Set(result.executions.map((e) => e.repeat?.groupId)).size).toBe(1);
    expect(new Set(result.executions.map((e) => e.repeat?.total))).toEqual(new Set([3]));
  });

  it("starts an incremental sink once per execution, with repeat only when there are several", async () => {
    const starts: unknown[] = [];
    const sink: IncrementalResultsSink = { start: (args) => { starts.push(args.repeat); }, add: () => {}, finish: () => {} };
    await runExperiment({ data: rows, task: agent, evaluators: [], name: "g", sink, repeats: 2 });
    expect(starts).toHaveLength(2);
    expect(starts.map((r) => (r as { index: number }).index)).toEqual([1, 2]);
    starts.length = 0;
    await runExperiment({ data: rows, task: agent, evaluators: [], name: "g", sink });
    expect(starts).toEqual([undefined]);
  });

  it.each([0, -1, 11, 2.5, Number.NaN])("rejects repeats=%s", async (bad) => {
    await expect(runExperiment({ data: rows, task: agent, evaluators: [], name: "x", sink: null, repeats: bad })).rejects.toThrow("repeats");
  });

  it("summarises each evaluator's mean and noise across executions", async () => {
    // execution 1: both right (1) · execution 2: one wrong (0.5) · execution 3: both right (1)
    const outputs = ["echo a", "echo b", "wrong", "echo b", "echo a", "echo b"];
    let n = 0;
    const result = await runExperiment({ data: rows, task: () => outputs[n++], evaluators: [exactMatch], name: "n", sink: null, repeats: 3, maxWorkers: 1 });
    const [summary] = result.summary();
    expect(summary).toMatchObject({ name: "exact_match", values: [1, 0.5, 1] });
    expect(summary!.mean).toBeCloseTo(5 / 6);
    expect(summary!.noise).toBeCloseTo(0.28867513, 6);   // sample standard deviation of (1, .5, 1)
  });

  it("has no noise to report from a single execution", () => {
    const one = new RepeatedExperimentResult("n", [new ExperimentResult("n", [{ item: { input: "a" }, scores: [{ name: "m", value: true, dataType: "boolean" }] }])]);
    expect(one.summary()[0]!.noise).toBeUndefined();
  });
});

describe("Faithfulness", () => {
  it("needs a context on the item", () => {
    expect(() => new Faithfulness({ client: { complete: async () => "" } }).buildPrompt({ input: "q", output: "a" })).toThrow("context");
  });
});

describe("suggestFix", () => {
  const llm = (answer: string) => ({ complete: async () => answer });
  const cases = [{ input: "hola", error: "wrong city" }];
  it("returns the improved prompt and its rationale, tolerating a fenced answer", async () => {
    const proposal = await suggestFix("Eres un asistente. {{ciudad}}", cases, llm('```json\n{"prompt": "Eres un asistente preciso. {{ciudad}}", "rationale": "Más preciso."}\n```'));
    expect(proposal).toEqual({ content: "Eres un asistente preciso. {{ciudad}}", rationale: "Más preciso." });
  });
  it.each([
    ["not json", "did not answer"],
    ['{"prompt": "same {{a}}"}', "unchanged"],
    ['{"prompt": "other {{b}}"}', "changes the variables"],
    ['{"rationale": "x"}', "no prompt"],
  ])("refuses %s", async (answer, message) => {
    await expect(suggestFix("same {{a}}", cases, llm(answer))).rejects.toThrow(message);
    await expect(suggestFix("same {{a}}", cases, llm(answer))).rejects.toBeInstanceOf(FixProposalError);
  });
  it("needs at least one case", async () => { await expect(suggestFix("p", [], llm("{}"))).rejects.toThrow("at least one"); });
});
