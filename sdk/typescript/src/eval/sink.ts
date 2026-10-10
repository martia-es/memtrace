import { HttpClient, type HttpOptions } from "../http/client.js";
import { resolveRevision } from "../config.js";
import type { EvalItemResult, ExperimentResult, IncrementalResultsSink, Score } from "./types.js";

const VERSION = /^\d+\.\d+$/;
const MAX_BATCH = 1000; // the API caps a batch at 1000 items

function serializeScore(score: Score): Record<string, unknown> {
  // the API stores `value` as a string; booleans serialize lowercase so they round-trip with "true"/"false"
  return {
    name: score.name,
    value: typeof score.value === "boolean" ? (score.value ? "true" : "false") : String(score.value),
    dataType: score.dataType,
    source: score.source ?? "code",
    comment: score.comment ?? null,
    judgeModel: score.judgeModel ?? null,
    judgePromptHash: score.judgePromptHash ?? null,
  };
}

function serializeItem(result: EvalItemResult): Record<string, unknown> {
  return {
    input: result.item.input,
    expectedOutput: result.item.expectedOutput ?? null,
    output: result.output ?? null,
    traceId: result.traceId ?? null,
    error: result.error ?? null,
    scores: result.scores.map(serializeScore),
  };
}

/**
 * Uploads an experiment to MemTrace as a run of `datasetId`, batch by batch while it runs: `start()` opens it (`running`), every
 * `batchSize` finished items are posted and `finish()` closes it (`completed`). A failed batch is kept and retried with the next
 * one (the API overwrites by item position), so a transient outage does not lose results; only `finish()` rejects if something
 * is still unsent. A run must say which dataset version it ran against (`version`, or the one the source reports).
 */
export class MemTraceResultsSink implements IncrementalResultsSink {
  /** Id of the run created by the last upload, e.g. to build a dashboard link. */
  lastRunId?: string;
  private version?: string;
  private pending: Array<Record<string, unknown>> = [];
  private readonly http: HttpClient;
  private readonly batchSize: number;

  constructor(private readonly datasetId: string, options: HttpOptions & { version?: string; batchSize?: number } = {}) {
    this.version = options.version;
    this.batchSize = Math.max(1, options.batchSize ?? 20);
    this.http = new HttpClient(options);
  }

  async start({ name, datasetVersion }: { name: string; datasetVersion?: string }): Promise<void> {
    const version = this.version ?? datasetVersion;
    if (!version || !VERSION.test(version)) {
      throw new Error(
        `A MemTrace run must record the dataset version it ran against as 'major.minor'; got ${JSON.stringify(version)}. ` +
          "Read the data with a MemTrace dataset id or pass version: '2.1' to MemTraceResultsSink.",
      );
    }
    this.version = version;
    this.pending = [];
    const body: Record<string, unknown> = { name, datasetVersion: version, complete: false, items: [] };
    const { sha, dirty } = resolveRevision();
    if (sha) body.revision = { sha, dirty: dirty ?? null }; // the commit that was evaluated (ADR-065)
    const reply = await this.http.request("POST", `/datasets/${this.datasetId}/runs`, { json: body });
    this.lastRunId = (await reply.json()).id;
  }

  async add(index: number, result: EvalItemResult): Promise<void> {
    this.pending.push({ itemIndex: index, ...serializeItem(result) });
    if (this.pending.length >= this.batchSize) {
      try { await this.flush(false); } catch { /* kept in `pending`, resent with the next batch */ }
    }
  }

  async finish(_result: ExperimentResult): Promise<void> {
    await this.flush(true);
  }

  /** One-shot upload of a finished result. */
  async save(result: ExperimentResult): Promise<void> {
    await this.start({ name: result.name, datasetVersion: result.datasetVersion });
    result.items.forEach((item, index) => this.pending.push({ itemIndex: index, ...serializeItem(item) }));
    await this.finish(result);
  }

  private async flush(complete: boolean): Promise<void> {
    while (this.pending.length > 0 || complete) {
      const batch = this.pending.slice(0, MAX_BATCH);
      const last = batch.length === this.pending.length;
      await this.http.request("POST", `/datasets/${this.datasetId}/runs/${this.lastRunId}/items`, {
        json: { items: batch, complete: complete && last },
      });
      this.pending = this.pending.slice(batch.length);
      if (this.pending.length === 0) return;
    }
  }
}
