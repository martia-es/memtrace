/**
 * Retrieval metrics for RAG agents (ADR-045): recall@k, MRR, hit rate. Relevance labels live in the dataset item:
 * `metadata.relevant_docs` is a list of ids/sources. A chunk is relevant when its `id` or `source` is in that list. Items
 * without labels get no score (not a zero), so a dataset can mix labelled and unlabelled items.
 */
import { evaluator } from "./builtins.js";
import type { Evaluator, RetrievedChunk, Score } from "./types.js";

export const DEFAULT_RELEVANT_KEY = "relevant_docs";

const keysOf = (chunk: RetrievedChunk): string[] =>
  [chunk.id, chunk.source].filter((v) => v !== undefined && v !== null).map(String);

/** 1-based ranks of the chunks that match a not-yet-found relevant doc. */
function relevantRanks(retrieved: RetrievedChunk[], relevant: Set<string>): number[] {
  const found = new Set<string>();
  const ranks: number[] = [];
  retrieved.forEach((chunk, i) => {
    const fresh = keysOf(chunk).filter((k) => relevant.has(k) && !found.has(k));
    if (fresh.length > 0) { fresh.forEach((k) => found.add(k)); ranks.push(i + 1); }
  });
  return ranks;
}

export function recallAtK(retrieved: RetrievedChunk[], relevant: Iterable<string>, k: number): number {
  const wanted = new Set([...relevant].map(String));
  if (wanted.size === 0) throw new Error("recallAtK needs at least one relevant doc");
  const hit = new Set(retrieved.slice(0, k).flatMap(keysOf).filter((key) => wanted.has(key)));
  return hit.size / wanted.size;
}

export function reciprocalRank(retrieved: RetrievedChunk[], relevant: Iterable<string>): number {
  const ranks = relevantRanks(retrieved, new Set([...relevant].map(String)));
  return ranks.length > 0 ? 1 / ranks[0]! : 0;
}

function retrievalEvaluator(name: string, relevantKey: string, score: (retrieved: RetrievedChunk[], relevant: Set<string>) => Score["value"], dataType: Score["dataType"]): Evaluator {
  return evaluator(name, ({ metadata, retrievedChunks }) => {
    let relevant = metadata?.[relevantKey];
    if (!relevant || (Array.isArray(relevant) && relevant.length === 0)) return []; // unlabelled: no score rather than a misleading 0
    if (typeof relevant === "string") relevant = [relevant];
    return [{ name, value: score(retrievedChunks, new Set((relevant as unknown[]).map(String))), dataType }];
  });
}

/** `recall_at_<k>`: fraction of the item's relevant docs found in the top-k retrieved chunks. */
export function RecallAtK(k = 5, options: { relevantKey?: string } = {}): Evaluator {
  if (k < 1) throw new Error("k must be >= 1");
  return retrievalEvaluator(`recall_at_${k}`, options.relevantKey ?? DEFAULT_RELEVANT_KEY, (r, rel) => recallAtK(r, rel, k), "numeric");
}

/** `mrr`: reciprocal rank of the first relevant chunk (its mean over a run is the Mean Reciprocal Rank). */
export function MRR(options: { relevantKey?: string } = {}): Evaluator {
  return retrievalEvaluator("mrr", options.relevantKey ?? DEFAULT_RELEVANT_KEY, (r, rel) => reciprocalRank(r, rel), "numeric");
}

/** `hit_rate`: whether at least one relevant doc was retrieved (boolean). */
export function HitRate(options: { relevantKey?: string } = {}): Evaluator {
  return retrievalEvaluator("hit_rate", options.relevantKey ?? DEFAULT_RELEVANT_KEY, (r, rel) => relevantRanks(r, rel).length > 0, "boolean");
}
