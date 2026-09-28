# ADR-022: Topic Extraction with BERTopic, as an Async Enrichment Pipeline

* **Status**: Accepted
* **Date**: 2026-09-28
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The roadmap's Fase 2 ("Mem") calls for extracting knowledge from traces, but its Redis-based knowledge graph targets failure patterns, not what users are actually asking the agent about. We want to know the *topics* of each AI response, without depending on a third-party LLM (cost per token, external dependency, non-reproducible output across runs).

## Decision Drivers

* No LLM calls: the classification must run with a local, deterministic model.
* Must not touch the write path defined in ADR-003 (`otel_traces` schema is owned only by migrations, fed only by the Collector exporter).
* Topic labels shown in the dashboard must stay stable across runs — reclassifying the same response twice should not rename its topic.

## Decision Outcome

1. **Algorithm**: [BERTopic](https://maartengr.github.io/BERTopic/) — a local sentence-embedding model (`sentence-transformers`) turns each AI response into a vector, then clustering (HDBSCAN/UMAP) and per-cluster c-TF-IDF derive a topic name. No generative LLM call, no external API.
2. **Fit vs. transform**: the model is **fit once** on a historical batch of responses (`topic_model.fit(...)`, run manually as a one-off), then **serialized** to disk. Every subsequent run only calls `.transform()` to assign new responses to the existing topics. This keeps topic names stable; re-fitting is a deliberate, manual action when topics visibly drift, not an automatic side effect of a scheduled run.
3. **New component**: `analytics/topic_extraction`, a standalone Python package — not part of `sdk/python` (the instrumentation library that ships inside the user's agent process) and not part of the TypeScript API. It only talks to ClickHouse.
4. **Storage**: a new table, `memtrace.span_topics` (migration `003_span_topics.sql`), keyed by `(TraceId, SpanId)`. Separate from `otel_traces` because it is written asynchronously, after the fact, and can be recomputed (model upgrade, manual re-fit) without touching the original trace data. `ReplacingMergeTree` lets a re-run overwrite a span's topic without duplicate rows.
5. **Scheduling**: a Kubernetes `CronJob` (`k8s/80-topic-extraction.yaml`), not a long-running service — the workload is periodic batch, not request/response, so it doesn't need to be always-on.
6. **Read path**: exposed through `TraceRepository` (roadmap piece 4) like every other query, never with SQL in a route handler.

## Consequences

* **Positive**: no per-token cost, no external dependency, deterministic given the same fitted model; fits the roadmap's "pieza 4 encapsula el esquema" rule.
* **Negative**:
  * The initial fit needs a representative historical batch chosen and run by hand; a cold system has no topics until that first fit happens.
  * BERTopic's `.transform()` can assign a genuinely new kind of question to the closest existing topic ("outlier" bucket) rather than a new one — the model needs periodic manual re-fits as the traffic mix evolves, which is an operational task, not an automated one.
  * Adds a Python runtime dependency (`sentence-transformers`, `bertopic`) and a small PVC to persist the fitted model, distinct from anything the API (Node/TypeScript) or the SDK already need.
