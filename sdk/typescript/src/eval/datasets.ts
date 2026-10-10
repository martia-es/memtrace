import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { HttpClient, type HttpOptions } from "../http/client.js";
import type { DatasetSource, EvalItem } from "./types.js";

/** Plain `{input, expectedOutput?, metadata?}` rows (also `expected_output`, as in dataset files written for the Python SDK). */
export function toItem(row: Record<string, any>): EvalItem {
  if (!("input" in row)) throw new Error("A dataset row needs an `input`");
  return { input: row.input, expectedOutput: row.expectedOutput ?? row.expected_output ?? undefined, metadata: row.metadata ?? undefined };
}

export class InMemoryDatasetSource implements DatasetSource {
  constructor(private readonly rows: Array<EvalItem | Record<string, any>>) {}
  fetch(): EvalItem[] {
    return this.rows.map((row) => toItem(row as Record<string, any>));
  }
}

/** Reads a `.json` (list of rows) or `.jsonl` (one row per line) file. `version` is a content fingerprint (`sha256:<12 hex>`). */
export class LocalFileDatasetSource implements DatasetSource {
  version?: string;
  constructor(private readonly path: string) {}

  async fetch(): Promise<EvalItem[]> {
    const raw = await readFile(this.path);
    this.version = `sha256:${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
    const text = raw.toString("utf8");
    const rows = extname(this.path).toLowerCase() === ".jsonl"
      ? text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
      : JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error(`${this.path}: expected a JSON list of rows`);
    return rows.map(toItem);
  }
}

/**
 * Fetches a dataset's items from MemTrace's API by id. `version` ("major.minor") reads that exact version, otherwise the latest.
 * After `fetch()`, `version` holds the version the server actually served, so a run is never attributed to one it did not read.
 */
export class MemTraceDatasetSource implements DatasetSource {
  version?: string;
  private readonly requested?: string;

  constructor(private readonly datasetId: string, options: HttpOptions & { version?: string } = {}) {
    this.version = this.requested = options.version;
    this.options = options;
  }
  private readonly options: HttpOptions;

  async fetch(): Promise<EvalItem[]> {
    const reply = await new HttpClient(this.options).request("GET", `/datasets/${this.datasetId}/items`, { query: { version: this.requested } });
    const body = await reply.json();
    if (body.version) this.version = `${body.version.major}.${body.version.minor}`;
    return body.items.map((row: any) => ({ input: row.input, expectedOutput: row.expectedOutput ?? undefined, metadata: row.metadata ?? undefined }));
  }
}
