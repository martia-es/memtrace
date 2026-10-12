/**
 * Offline evaluation: run your agent against a dataset and score its output, in your own process (ADR-027).
 *
 *     const result = await runExperiment({
 *       data: [{ input: "2+2?", expectedOutput: "4" }],
 *       task: (item) => myAgent(item.input),
 *       evaluators: [exactMatch],
 *       name: "smoke-test",
 *       sink: null,                    // keep the result in memory; do not touch MemTrace
 *     });
 *
 * `data` may also be a path to a `.json` / `.jsonl` file, a `DatasetSource`, or a MemTrace dataset id (`{ datasetId }`), whose
 * results are uploaded back to that dataset unless you pass your own `sink`.
 */
import type { HttpOptions } from "../http/client.js";
import { currentTraceId, isTracing, withStep } from "../tracer.js";
import { InMemoryDatasetSource, LocalFileDatasetSource, MemTraceDatasetSource } from "./datasets.js";
import { retrievalScope } from "./retrievalScope.js";
import { randomUUID } from "node:crypto";
import { MemTraceResultsSink } from "./sink.js";
import {
  ExperimentResult, RepeatedExperimentResult, isIncremental,
  type DatasetSource, type EvalItem, type EvalItemResult, type Evaluator, type EvaluatorLike, type IncrementalResultsSink, type ResultsSink, type RetrievedChunk, type RunRepeat, type Score, type TaskFunction,
} from "./types.js";

/** The sink failed to persist the results. The experiment itself finished: `result` has everything. */
export class ResultsUploadError extends Error {
  constructor(message: string, readonly result: ExperimentResult) {
    super(message);
    this.name = "ResultsUploadError";
  }
}

export type DataInput = { datasetId: string; version?: string } | string | DatasetSource | Array<EvalItem | Record<string, any>>;

export interface RunExperimentOptions extends HttpOptions {
  /** A MemTrace dataset (`{ datasetId, version? }`), a path to a `.json` / `.jsonl` file, a `DatasetSource` or plain rows. */
  data: DataInput;
  task: TaskFunction;
  evaluators: EvaluatorLike[];
  name: string;
  /** Where results go. Omitted, they upload only when `data` is a MemTrace dataset. `null` keeps them in memory. */
  sink?: ResultsSink | IncrementalResultsSink | null;
  maxWorkers?: number;
  /**
   * Run the whole experiment this many times (1-10, default 1) in one call, under identical conditions, to measure how much the
   * result moves when nothing changes (ADR-097). With 1 you get an `ExperimentResult`; with more, a `RepeatedExperimentResult`.
   * Each execution is uploaded as its own run and the dashboard groups them. Multiplies time and tokens by `repeats`.
   */
  repeats?: number;
}

export const MAX_REPEATS = 10;

const isSource = (data: unknown): data is DatasetSource => typeof data === "object" && data !== null && "fetch" in data;

const asEvaluator = (e: EvaluatorLike): Evaluator =>
  typeof e === "function" ? e : (Object.defineProperty((args) => e.evaluate(args), "name", { value: e.name }) as Evaluator);

async function runItem(item: EvalItem, task: TaskFunction, evaluators: Evaluator[]): Promise<EvalItemResult> {
  let traceId: string | undefined;
  let output: unknown;
  const chunksOf = { current: [] as RetrievedChunk[] };
  try {
    await retrievalScope(async (chunks) => {
      chunksOf.current = chunks;
      const call = async () => { traceId = currentTraceId(); output = await task(item); };
      // one root step (`eval.item`) per item, so its trace id links the run to latency, tokens and cost (ADR-044)
      if (isTracing()) await withStep("eval.item", "chain", call);
      else await call();
    });
  } catch (error) {
    return { item, error: error instanceof Error ? error.message : String(error), traceId, scores: [] };
  }

  const scores: Score[] = [];
  for (const evaluator of evaluators) {
    try {
      const result = await evaluator({
        input: item.input, output, expectedOutput: item.expectedOutput, metadata: item.metadata, traceId,
        retrievedChunks: chunksOf.current,
      });
      scores.push(...(Array.isArray(result) ? result : [result]));
    } catch (error) {
      // one bad evaluator never blanks the row
      scores.push({ name: evaluator.name, value: error instanceof Error ? error.message : String(error), dataType: "categorical", source: "code", comment: "evaluator raised" });
    }
  }
  return { item, output, traceId, scores };
}

/** Runs `task` against every item of `data` and scores each output with `evaluators`. */
export async function runExperiment(options: RunExperimentOptions & { repeats?: 1 }): Promise<ExperimentResult>;
export async function runExperiment(options: RunExperimentOptions & { repeats: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 }): Promise<RepeatedExperimentResult>;
export async function runExperiment(options: RunExperimentOptions): Promise<ExperimentResult | RepeatedExperimentResult>;
export async function runExperiment(options: RunExperimentOptions): Promise<ExperimentResult | RepeatedExperimentResult> {
  const { data, task, evaluators, name, maxWorkers = 4, repeats = 1 } = options;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_REPEATS) {
    throw new RangeError(`repeats must be an integer between 1 and ${MAX_REPEATS}; got ${JSON.stringify(repeats)}`);
  }
  const http: HttpOptions = { baseUrl: options.baseUrl, apiKey: options.apiKey, fetch: options.fetch, timeoutMs: options.timeoutMs };

  let source: DatasetSource;
  let sink: ResultsSink | IncrementalResultsSink | null | undefined = options.sink;
  if (typeof data === "object" && data !== null && !Array.isArray(data) && "datasetId" in data) {
    source = new MemTraceDatasetSource(data.datasetId, { ...http, version: data.version });
    if (sink === undefined) sink = new MemTraceResultsSink(data.datasetId, { ...http, version: data.version });
  } else if (typeof data === "string") {
    source = new LocalFileDatasetSource(data);
  } else if (isSource(data)) {
    source = data;
  } else {
    source = new InMemoryDatasetSource(data);
  }

  const resolved = evaluators.map(asEvaluator);
  const items = await source.fetch(); // read once: every execution sees exactly the same items
  const datasetVersion = source.version;
  const incremental = isIncremental(sink) ? sink : undefined;

  const groupId = randomUUID();
  const executions: ExperimentResult[] = [];
  for (let index = 1; index <= repeats; index++) {
    const repeat: RunRepeat | undefined = repeats > 1 ? { groupId, index, total: repeats } : undefined;
    executions.push(await executeOnce(items, datasetVersion, task, resolved, name, sink, incremental, maxWorkers, repeat));
  }
  return repeats === 1 ? executions[0]! : new RepeatedExperimentResult(name, executions, datasetVersion);
}

async function executeOnce(
  items: EvalItem[], datasetVersion: string | undefined, task: TaskFunction, resolved: Evaluator[], name: string,
  sink: ResultsSink | IncrementalResultsSink | null | undefined, incremental: IncrementalResultsSink | undefined,
  maxWorkers: number, repeat: RunRepeat | undefined,
): Promise<ExperimentResult> {
  if (incremental) await incremental.start(repeat ? { name, datasetVersion, repeat } : { name, datasetVersion });

  const results: EvalItemResult[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await runItem(items[index]!, task, resolved);
      if (incremental) {
        try { await incremental.add(index, results[index]!); } catch { /* the experiment continues */ }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(maxWorkers, items.length)) }, worker));

  const result = new ExperimentResult(name, results, datasetVersion, repeat);
  try {
    if (incremental) await incremental.finish(result);
    else if (sink && "save" in sink) await sink.save(result);
  } catch (error) {
    throw new ResultsUploadError(`experiment ${JSON.stringify(name)} finished but its results could not be saved: ${(error as Error).message}`, result);
  }
  return result;
}
