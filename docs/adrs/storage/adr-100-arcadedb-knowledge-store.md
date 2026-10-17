# ADR-100: ArcadeDB as the Knowledge Store of Phase 2 (Mem), Optional and Behind a Port

* **Status**: Accepted — not implemented. The choice is fixed; the points marked **To verify** are gates of a proof of concept that must pass before phase 2.1 is built (see section 6)
* **Date**: 2026-10-18
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-003](adr-003-clickhouse-schema-and-migrations.md), [ADR-084](adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-088](../cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md), [ADR-096](../infra/adr-096-production-operations-backups-helm-load-gates.md), [ADR-099](adr-099-deduplicated-span-storage.md), [roadmap, phase 2](../../roadmap.md)

## Context and Problem Statement

Phase 2 (Mem) must find recurring failure patterns across traces, keep what it learned, and answer questions such as "what do we know about tool X or error Y". That needs two capabilities the current stores do not give: **multi-hop relations** (agent → tool → error → strategy) and **similarity search** over embeddings of failed traces. The roadmap proposed Redis Stack for both. Question Q1 of the phase 2 design draft (`phase_2_design.md`) asked which store to use.

Facts that shape the decision:

- **Redis Stack no longer fits.** RedisGraph reached end of life on 2025-01-31 and was removed from Redis Stack; Redis 8 absorbed the other modules and its license options include AGPLv3. The "Redis Stack OpenSource" named in the roadmap is not a product to build on.
- **MemTrace is open source (MIT) and is installed by its users**, not operated by us. A store we ship in the Helm chart and in the local cluster is a license we pass on to every installer, and a component each of them must run.
- **Two stores already exist and are operated** (ClickHouse for traces, PostgreSQL for curated data), with backups ([ADR-096](../infra/adr-096-production-operations-backups-helm-load-gates.md)), tenant isolation ([ADR-088](../cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md)) and retention ([ADR-084](adr-084-data-protection-retention-masking-audit-and-export.md)). A third store is justified only if it brings something those two cannot.

## Decision Drivers

1. License compatible with MIT and with users redistributing or hosting MemTrace.
2. Graph and vector search in one engine, so a hybrid query ("failures similar to this one that involve tool X") does not cross two systems.
3. A real high-availability story for the installers who need it.
4. No hard dependency: installations that do not use Mem must not pay for it.

## Considered Options

| Option | Verdict |
|---|---|
| **ArcadeDB** (Apache 2.0): multi-model, openCypher, vector embeddings with HNSW, Raft replication | **Chosen** |
| Redis Stack / Redis 8 | Rejected: graph module discontinued, AGPLv3 in the options, data held in RAM |
| FalkorDB (SSPLv1) | Rejected: SSPL §13 obliges publishing the whole service stack for anyone who offers the database's functionality to third parties as a service, and many companies block SSPL by policy. Internal use is not affected, but the license would travel with every distribution of MemTrace |
| Neo4j Community (GPLv3) | Rejected: clustering and online backup are Enterprise-only, so HA would need a paid edition |
| PostgreSQL + `pgvector` (+ recursive CTEs or Apache AGE) | Kept as the **fallback** (see section 7). Permissive license and nothing new to operate, but multi-hop graph queries are awkward and `pgvector` filters after the approximate index scan, which is a risk for per-organization queries |
| ClickHouse vector indexes | Not evaluated against 24.3; mixing mutable knowledge with an append-only trace store is also a poor fit |

## Decision Outcome

### 1. ArcadeDB holds what Mem learns; it never holds traces

| Stored in ArcadeDB | Not stored there |
|---|---|
| Failure **patterns** (rule that found it, counts, first and last seen, status new / reviewed / dismissed) | Traces and their content: stay in ClickHouse |
| **Evidence**: ids of the traces and spans that back a pattern (references, not copies) | Prompts and fragments: stay in the prompt registry (ADR-067, ADR-073) |
| **Embeddings** of failed traces and their clusters (phase 2.1) | Approvals, permissions, audit: stay in PostgreSQL |
| **Relations** between agent, tool, model, error and strategy (phase 2.4) | Prompt-version evidence: still computed by the Fase 1.8 mechanisms |
| Link from a candidate to the prompt draft that carries it | |

Storing references instead of content keeps PII and retention where they are already controlled: opening the evidence goes through the existing query API and its masking.

### 2. Optional by design, behind a port

- **Phase 2.0 (sequence patterns from rules, ADR-066) needs no ArcadeDB**; it uses tables that already exist. A user who never enables Mem never runs it.
- ArcadeDB is a separate, opt-in deployment: a Kustomize overlay and a Helm value (`mem.enabled`), off by default, like Prometheus and Grafana in ADR-098.
- The analyzer talks to a `KnowledgeStore` port (patterns, evidence, similar-traces, relations), as `TraceRepository` does in [ADR-009](../api/adr-009-query-api-contract.md). ArcadeDB is one adapter; a PostgreSQL adapter is the fallback. No code outside the adapter knows the engine.

### 3. Tenancy

Patterns belong to an experiment and its organization, and a consultancy must never learn from one client's data to apply it to another ([ADR-091](../cybersecurity/adr-091-client-boundary-for-multi-client-organizations.md)). The default design is **one ArcadeDB database per organization**, with the experiment id on every vertex and in every query predicate, applied in the adapter and not by the caller. **To verify**: that per-database isolation, credentials and backup are practical, and the cost of many small databases.

### 4. Retention and PII

- Every vertex and embedding carries the experiment id and the timestamp of the trace it came from; a retention job deletes them when the trace expires under the experiment's policy (ADR-084). An embedding of text with PII is personal data, so it is deleted with its source.
- Embeddings are computed from content already masked by the SDK and the Collector. Where they are computed (local model or external provider) is question Q2 of the design draft and is **not** decided here.
- **To verify**: that deleting by predicate removes the vector index entries and leaves no recoverable copy in the backups' retention window.

### 5. Operations

Same bar as any store added after [ADR-096](../infra/adr-096-production-operations-backups-helm-load-gates.md): scheduled backup and a restore test, encryption at rest in the same pending list as the other stores (`security-pending.md`), network policy that admits only the Mem workers and the query API (ADR-090), and no shared administrator credential. A single node is the default; Raft replication is documented as the option for installers that need availability.

## 6. Proof of Concept Gates (before phase 2.1)

Run in a worktree with patterns derived from the real traces of the weather and RAG assistants. The store is confirmed only if all of these hold; otherwise fall back to section 7.

| Gate | Pass criterion |
|---|---|
| Hybrid query | A top-k similarity query filtered by organization and experiment returns k results when k exist (the `pgvector` post-filter problem must not appear) |
| Isolation | A query under one organization cannot read another's vertices, by construction and by an automated test |
| Retention | Deleting an experiment's knowledge removes vertices, edges and vector entries; verified after a restore |
| Backup | Backup and restore round trip on the local cluster and the Helm chart |
| Footprint | Memory and disk at 100k embeddings are acceptable for a laptop and for a small cluster |
| Client | A maintained client for Python (and a supported protocol such as HTTP or Bolt) with no unmaintained dependency |
| Cypher coverage | The 2.4 multi-hop queries expressed in the openCypher subset ArcadeDB implements |

## 7. Consequences

**Positive**
- Apache 2.0 matches MIT; installers and hosting providers inherit no copyleft or service-source obligation.
- One engine for relations and similarity, with replication available when needed.
- Nothing changes for users who do not enable Mem.

**Negative / risks**
- A third store to operate for those who enable Mem, with its own backup, upgrade and security surface.
- ArcadeDB is less widespread than Neo4j or Redis: fewer examples, a smaller community, and its vector search is documented with little detail on filtering and stability. This is why the PoC gates exist.
- Java runtime in the image (the Docker image targets Java 21 or 25).

**Fallback.** If a gate fails, the `KnowledgeStore` adapter for **PostgreSQL + `pgvector`** is built instead, with relations as edge tables; this ADR is then superseded by a new one. Because only the adapter changes, the cost of the fallback is bounded.

## 8. Rollout

1. Phase 2.0 on existing tables (no ADR-100 dependency).
2. PoC against the gates of section 6; record the result in this ADR as an update.
3. `KnowledgeStore` port, ArcadeDB adapter, opt-in deployment, backup job and tenant tests.
4. Phases 2.1 to 2.3 on top; 2.4 (graph queries) only if 2.0 to 2.3 show it is needed.
