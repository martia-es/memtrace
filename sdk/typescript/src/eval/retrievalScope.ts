/**
 * Per-item capture of the chunks a retriever returned, so retrieval metrics can score them (ADR-045). The runner opens a scope
 * around each task call and `recordRetrievedChunks` notes them here. Outside a scope everything is a no-op.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { RetrievedChunk } from "./types.js";

const scope = new AsyncLocalStorage<RetrievedChunk[]>();

/** Runs `fn` collecting, in call order, the chunks of every retriever call made inside it. */
export function retrievalScope<T>(fn: (chunks: RetrievedChunk[]) => T): T {
  const chunks: RetrievedChunk[] = [];
  return scope.run(chunks, () => fn(chunks));
}

export function noteRetrieved(chunks: RetrievedChunk[]): void {
  scope.getStore()?.push(...chunks);
}
