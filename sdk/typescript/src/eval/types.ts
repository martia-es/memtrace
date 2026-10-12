/**
 * Value objects and ports of offline evaluation (ADR-027, ADR-028, ADR-095). Plain on purpose: no MemTrace type leaks into an
 * evaluator or a task, so they stay portable outside MemTrace. Property names are camelCase; on the wire they are the same
 * as in the Python SDK.
 */
export type ScoreDataType = "numeric" | "boolean" | "categorical";
export type ScoreSource = "human" | "code" | "llm_judge";

/** One evaluator's verdict on one item. `dataType` should match the type of `value`. */
export interface Score {
  name: string;
  value: number | boolean | string;
  dataType: ScoreDataType;
  source?: ScoreSource; // default "code"
  comment?: string;
  /** Identity of the judge behind an `llm_judge` score (ADR-043). */
  judgeModel?: string;
  /** Fingerprints the rubric template, so it only changes when the judge itself changes. */
  judgePromptHash?: string;
}

/** One row of a dataset: what to feed the agent and, optionally, what to expect back. */
export interface EvalItem {
  input: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown>;
}

/** The outcome of one item. `error` is set (and `scores` empty) when the task itself threw. */
export interface EvalItemResult {
  item: EvalItem;
  output?: unknown;
  traceId?: string;
  scores: Score[];
  error?: string;
}

export interface ScoreSummary {
  name: string;
  dataType: ScoreDataType;
  count: number;
  /** Share of `true` of a boolean evaluator. */
  passRate?: number;
  /** Mean of a numeric evaluator. */
  average?: number;
}

/**
 * Execution `index` (1..`total`) of an experiment launched with `repeats: total` (ADR-097). All executions of one call share
 * `groupId`: same code, dataset version and evaluators, so any difference between them is noise, not a change you made.
 */
export interface RunRepeat {
  groupId: string;
  index: number;
  total: number;
}

export class ExperimentResult {
  constructor(readonly name: string, readonly items: EvalItemResult[], readonly datasetVersion?: string, readonly repeat?: RunRepeat) {}

  /** Items whose task threw (they have no scores). */
  get errorCount(): number {
    return this.items.filter((r) => r.error !== undefined).length;
  }

  /** Per-evaluator aggregate over every item, computed locally. */
  summary(): ScoreSummary[] {
    const grouped = new Map<string, Score[]>();
    for (const result of this.items) {
      for (const score of result.scores) {
        const key = JSON.stringify([score.name, score.dataType]);
        grouped.set(key, [...(grouped.get(key) ?? []), score]);
      }
    }
    return [...grouped.values()].map((scores) => {
      const { name, dataType } = scores[0]!;
      const summary: ScoreSummary = { name, dataType, count: scores.length };
      if (dataType === "boolean") summary.passRate = scores.filter((s) => s.value === true).length / scores.length;
      if (dataType === "numeric") {
        const numbers = scores.map((s) => s.value).filter((v): v is number => typeof v === "number");
        if (numbers.length > 0) summary.average = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      }
      return summary;
    });
  }
}

/** What an evaluator receives (by property). Use only the ones you need. */
export interface EvaluatorArgs {
  input: unknown;
  output: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown>;
  traceId?: string;
  /** Chunks the retriever returned while the task ran (ADR-045). */
  retrievedChunks: RetrievedChunk[];
}

/** A scoring function with a `name`: `Object.assign((args) => ..., { name: "mine" })`, a class instance with `name`, or a named function. */
export type Evaluator = ((args: EvaluatorArgs) => Score | Score[] | Promise<Score | Score[]>) & { readonly name: string };

/** What `runExperiment` accepts as an evaluator: a function with a `name`, or an object with `name` and `evaluate` (the judges). */
export type EvaluatorLike = Evaluator | { readonly name: string; evaluate(args: EvaluatorArgs): Score | Score[] | Promise<Score | Score[]> };

export type TaskFunction = (item: EvalItem) => unknown | Promise<unknown>;

export interface DatasetSource {
  /** The items to evaluate; called once per run. */
  fetch(): Promise<EvalItem[]> | EvalItem[];
  /** Whatever identifies exactly which data it returned; recorded on the result. Read after `fetch()`. */
  version?: string;
}

export interface ResultsSink {
  save(result: ExperimentResult): Promise<void> | void;
}

/**
 * A sink that receives results while the experiment runs, so a crash mid-run loses nothing already computed (ADR-034). Items
 * arrive as soon as they finish, NOT in dataset order, each with its position.
 */
export interface IncrementalResultsSink {
  /** With `repeats > 1` it is called once per execution and also receives `repeat` (ADR-097). */
  start(args: { name: string; datasetVersion?: string; repeat?: RunRepeat }): Promise<void> | void;
  add(index: number, result: EvalItemResult): Promise<void> | void;
  finish(result: ExperimentResult): Promise<void> | void;
}

export interface RetrievedChunk {
  text: string;
  id?: string | number;
  source?: string;
  score?: number;
}

/** A model's text reply that also carries the model id the provider actually served (ADR-043). */
export interface LLMReply {
  text: string;
  model?: string;
}

/**
 * What a judge, or `proposeFix`, needs to ask a model something (ADR-029, ADR-095): the smallest possible shape, so it works with
 * any vendor. There is no default provider in this SDK. `model` may expose the default model, which judges record on their score.
 */
export interface LLMClient {
  readonly model?: string;
  complete(args: { system: string; prompt: string; model?: string }): Promise<string | LLMReply>;
}

export const isIncremental = (sink: unknown): sink is IncrementalResultsSink =>
  typeof sink === "object" && sink !== null && "start" in sink && "add" in sink && "finish" in sink;

/** One evaluator across the executions of a repeated run (ADR-097): each execution's aggregate, their mean and their noise. */
export interface RepeatedScoreSummary {
  name: string;
  dataType: ScoreDataType;
  /** Pass rate (boolean) or average (numeric) of each execution; `undefined` where the evaluator produced nothing. */
  values: Array<number | undefined>;
  mean?: number;
  /** Sample standard deviation of `values`: how much the result moves when nothing changes. Needs 2+ values; rough with 2 or 3. */
  noise?: number;
}

/** The outcome of `runExperiment({ repeats: N })` with N > 1: N executions under identical conditions (ADR-097). */
export class RepeatedExperimentResult {
  constructor(readonly name: string, readonly executions: ExperimentResult[], readonly datasetVersion?: string) {}

  /** Per-evaluator mean and noise across executions, computed locally. Categorical evaluators are skipped. */
  summary(): RepeatedScoreSummary[] {
    const perExecution = this.executions.map((e) => new Map(e.summary().map((s) => [JSON.stringify([s.name, s.dataType]), s])));
    const keys = new Map<string, { name: string; dataType: ScoreDataType }>();
    for (const e of this.executions) for (const s of e.summary()) keys.set(JSON.stringify([s.name, s.dataType]), { name: s.name, dataType: s.dataType });
    return [...keys.entries()]
      .filter(([, k]) => k.dataType !== "categorical")
      .sort(([, a], [, b]) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(([key, { name, dataType }]) => {
        const values = perExecution.map((m) => { const s = m.get(key); return s === undefined ? undefined : dataType === "boolean" ? s.passRate : s.average; });
        const present = values.filter((v): v is number => v !== undefined);
        const mean = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : undefined;
        const noise = present.length >= 2 && mean !== undefined ? Math.sqrt(present.reduce((a, v) => a + (v - mean) ** 2, 0) / (present.length - 1)) : undefined;
        return { name, dataType, values, mean, noise };
      });
  }
}
