# ADR-039: Annotation Queues

* **Status**: Accepted — implemented (manual and filter-based population; run-item UI deferred to ADR-040)
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-036](adr-036-score-configs-annotation-rubrics.md), [ADR-037](adr-037-human-annotations-storage-and-api.md). Feeds into [ADR-038](../datasets/adr-038-promote-trace-to-dataset-item.md).

## Context and Problem Statement

With ADR-037 a person can annotate a trace they happen to be looking at. That does not scale into a review process: nobody knows which traces still need a look, the same trace can be reviewed twice or never, and there is no notion of "I finished my review batch". Langfuse and LangSmith call the solution *annotation queues*; MLflow calls it *labeling sessions*.

A queue is: a **set of targets** to review, a **rubric** (a subset of score configs), and a **per-target workflow state** (pending / in progress / done), optionally with assignment.

## Decision Drivers

* Queue state is transactional, small and relational (assignments, locks, status) -> PostgreSQL. The labels themselves stay in ClickHouse (ADR-037). The design must therefore handle a **dual-store write** explicitly.
* Several reviewers working simultaneously must not be handed the same item.
* Must not duplicate trace data: the queue holds ids, not content.
* Population by rules/sampling over live traffic is "evaluación online", which the roadmap excludes from Phase 1.75. This ADR delivers manual and filter-based population only.

## Decision Outcome

### Schema (`migrations/postgres/014_annotation_queues.sql`)

```sql
CREATE TABLE annotation_queues (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id        UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  instructions         TEXT,                          -- guidelines shown above the rubric
  required_annotations INT  NOT NULL DEFAULT 1 CHECK (required_annotations BETWEEN 1 AND 10),
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX annotation_queues_name_idx ON annotation_queues (experiment_id, name) WHERE archived_at IS NULL;

CREATE TABLE annotation_queue_configs (            -- the rubric of the queue
  queue_id  UUID NOT NULL REFERENCES annotation_queues(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES score_configs(id),
  required  BOOLEAN NOT NULL DEFAULT true,
  position  INT NOT NULL,
  PRIMARY KEY (queue_id, config_id)
);

CREATE TABLE annotation_queue_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id      UUID NOT NULL REFERENCES annotation_queues(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL CHECK (target_type IN ('trace','run_item')),
  trace_id      TEXT NOT NULL DEFAULT '',
  dataset_run_id UUID,
  item_index    INT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  added_by      UUID NOT NULL REFERENCES users(id),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (queue_id, target_type, trace_id, dataset_run_id, item_index)
);
CREATE INDEX annotation_queue_items_pending_idx ON annotation_queue_items (queue_id, status, added_at);

CREATE TABLE annotation_queue_claims (              -- one row per reviewer per item
  queue_item_id UUID NOT NULL REFERENCES annotation_queue_items(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  skipped_at    TIMESTAMPTZ,
  PRIMARY KEY (queue_item_id, user_id)
);
```

(The uniqueness constraint over nullable columns needs `NULLS NOT DISTINCT` (PostgreSQL 15+) or a coalesced expression index; the implementer must check the PostgreSQL version in the manifests and choose accordingly.)

### Why a separate `claims` table instead of `assigned_to` on the item

`required_annotations > 1` (several independent labels per item, needed for agreement metrics in [ADR-040](adr-040-judge-human-agreement.md)) means one item has several reviewers. A single `assigned_to` column cannot represent that. The item's own `status` becomes **derived from claims**: it is `completed` when the count of claims with `completed_at` reaches `required_annotations`.

### Semantics

* **No pre-assignment in this ADR.** Reviewers *pull* the next item: `POST .../queues/:queueId/next`. This avoids an admin UI for assigning N items to M people and handles members joining mid-way. Explicit assignment can be added later as an optional `assigned_to` on claims.
* **Pull with a lease.** `next` runs in a single transaction:
  ```sql
  SELECT i.* FROM annotation_queue_items i
   WHERE i.queue_id = $1 AND i.status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM annotation_queue_claims c WHERE c.queue_item_id = i.id AND c.user_id = $2)
     AND (SELECT count(*) FROM annotation_queue_claims c
           WHERE c.queue_item_id = i.id AND c.skipped_at IS NULL
             AND (c.completed_at IS NOT NULL OR c.claimed_at > now() - interval '15 minutes')) < $3  -- required_annotations
   ORDER BY i.added_at
   FOR UPDATE OF i SKIP LOCKED
   LIMIT 1;
  ```
  then inserts the claim. `SKIP LOCKED` prevents two simultaneous callers from getting the same row; the 15 minute lease frees items abandoned by a closed tab without any background job (stale claims simply stop counting). Lease length is a config constant, not per-queue.
* A reviewer who already has an unfinished claim is returned that item first (resume), so refreshing the page does not burn another item.
* **Skip** sets `skipped_at` on that user's claim; the item returns to the pool for others, and to the same reviewer too, but only after every item they have not seen yet and oldest skip first (so a single reviewer never loses items by skipping; re-claiming clears `skipped_at`). If **every** eligible reviewer skips, an admin sees it as "skipped" in the queue overview (item `status` set to `skipped` by a "mark unreviewable" admin action, not automatically).

### Completing an item (the dual-store write)

Annotations go to ClickHouse, state goes to PostgreSQL; there is no distributed transaction. Order and recovery:

1. `POST .../queues/:queueId/items/:itemId/complete` with the labels `[ { configId, value, comment } ]`.
2. The service validates against the queue rubric: all `required` configs present and each value valid (reusing ADR-037 validation).
3. **Write annotations to ClickHouse first** (idempotent upsert per ADR-037 key).
4. **Then** set `completed_at` on the claim and recompute the item status in one PostgreSQL transaction.

Failure analysis:

| Failure | State | Recovery |
|---|---|---|
| Step 3 fails | nothing persisted | return `503`, user retries |
| Step 4 fails after 3 | labels exist but claim still open | the same request retried is idempotent (same ClickHouse keys, claim completed on retry); the lease eventually frees the item otherwise, and the already-written labels are visible but the item is not "done" yet. No data is lost or duplicated |
| Labels edited later outside the queue (ADR-037 panel) | claim stays completed | intentional; the queue records that a review *happened*, the annotations table holds the current label |

The inverse ordering (PostgreSQL first) was rejected: it can leave an item `completed` with **no** labels, a silent wrong state; the chosen ordering can only leave an item *not yet completed*, which is visible and self-heals.

### Populating a queue

```
POST /api/v1/experiments/:experimentId/annotation-queues/:queueId/items
body: { traceIds: string[] }                        # explicit selection, max 500, duplicates skipped
body: { fromFilter: { <same filter object as the traces list endpoint>, limit: number } }   # snapshot of matching traces now
```

* The filter form **resolves once at request time and stores trace ids**; a queue is not a live saved search, so its contents are stable while people review it.
* Every id is verified against the tenant (like ADR-037 step 4) in one batched `TraceRepository` query, not one query per id.
* Run items (`target_type = 'run_item'`) are added from the dataset run detail page (this is where judge-vs-human review of an evaluation run happens, [ADR-040](adr-040-judge-human-agreement.md)).
* Sampling rules over live traffic: **out of scope** (roadmap excludes online evaluation).

### API summary

```
GET/POST   /experiments/:id/annotation-queues
PATCH      /experiments/:id/annotation-queues/:queueId        (name, instructions, rubric; archive)
GET        /experiments/:id/annotation-queues/:queueId         (progress: pending/completed/skipped counts, per-reviewer counts)
POST       /experiments/:id/annotation-queues/:queueId/items
POST       /experiments/:id/annotation-queues/:queueId/next
POST       /experiments/:id/annotation-queues/:queueId/items/:itemId/complete
POST       /experiments/:id/annotation-queues/:queueId/items/:itemId/skip
```

Authorization: create/edit/archive queues -> `admin`; add items, pull, complete, skip -> `member`. Rubric configs of a started queue may be added but not removed (same compatibility spirit as ADR-036).

## Implementation Notes (decisions made while building)

* **`status` is a cache of the claims.** `annotation_queue_items.status` is recomputed from claims on every transition (`complete`, change of `required_annotations`) in a single `UPDATE`; claims are the source of truth and `status` exists so "list the pending ones" is an index scan. The only value set by hand is `skipped` (admin "mark unreviewable"), which recomputation never touches. The pure rule is `deriveItemStatus` in the domain.
* **`required_annotations` is edited through `PATCH`** together with name, instructions, rubric and archive. Changing it recomputes the whole queue in one statement. Raising it reopens `completed` items; a reviewer who already completed an item cannot take it again (one claim per user per item), so another person is needed. This is what keeps the labels independent.
* **`next` retries briefly under contention.** `FOR UPDATE SKIP LOCKED` never over-assigns, but when `required_annotations > 1` and another caller holds the lock on the only free item, a plain `SKIP LOCKED` returns "nothing left" although a slot remains. The adapter detects this with a non-locking probe and retries up to 4 times, 40 ms apart; once the other transaction commits the count is current and the answer is exact. Found by the concurrency test against a real PostgreSQL.
* **Items can be run items.** `POST .../items` accepts a third form, `{ runItems: [{ datasetRunId, itemIndex }] }`, verified against the experiment's runs and each run's item count. Labels on a run item are stored in `annotations` with `TargetType = 'run_item'` (the table already allowed it, ADR-037). The button that sends run items from the run detail page ships with ADR-040.
* **Extra endpoints**: `GET .../items?status=&limit=` (queue overview) and `POST .../items/:itemId/unreviewable` (admin), which the summary below did not list.
* **Authorization**: `member` pulls, completes, skips and adds items (ADR-037 already lets members annotate; the roadmap now says so); creating, editing and archiving queues and marking items unreviewable need `admin`.
* **Archived rubric configs** stop being required and stop accepting labels in `complete`; a queue cannot be created or extended with an archived config.
* **`complete` requires a claim.** The user must have pulled the item (a claim row exists, finished or not). That is what makes a retry after a PostgreSQL failure idempotent, and what stops someone labelling items nobody gave them.

## Amendment: random sampling and item provenance (ADR-040)

[ADR-040](adr-040-judge-human-agreement.md) measures judge-vs-human agreement over the items a queue holds, so it matters *how* they got there: labeling only the items the judge failed biases the result. This amendment adds the missing pieces; nothing above changes for existing callers.

* **`sample: { size, seed? }`** on `fromFilter` (replacing `limit`; exactly one of the two) and a new form **`{ fromRun: { datasetRunId, sample? } }`**. The server draws the sample (Fisher-Yates with a seeded PRNG, `domain/sampling.ts`), so it works for runs with thousands of items, which the 500-per-request cap of `runItems` could not express. `size` is 1–500. Without `seed` the server generates one; the response returns `sample: { seed, size, poolSize, truncated }` so the sample can be reproduced.
* **Pool limit**: a filtered sample is drawn from at most 5,000 matching trace ids (read in pages, ids only). If more traces match, `truncated: true` is returned and the sample comes only from the most recent 5,000; the dashboard says so. A run is always sampled from all its items.
* **`fromRun` without `sample`** takes every item and is refused (400, pointing to `sample`) above 500 items. `runItems` and `traceIds` are unchanged.
* **Provenance** (`migrations/postgres/015_queue_item_population.sql`): `annotation_queue_items.population` is `manual` (explicit ids/items; also every row from before the migration), `filter` (filter without sample, or a whole run) or `random_sample`, plus `sample_seed`. Items already in the queue keep their original provenance when added again. ADR-040's agreement card reads it to say how the sample was built. `population` is exposed on queue items; the seed is not.
* **Rejected**: storing provenance per queue (a queue can be fed by several batches of different kinds) and sampling in the dashboard (it would need to download every run item and could not be reproduced).

## Design Implications

* **Queue progress is cheap** (PostgreSQL counts); label content is not duplicated there.
* **Changing `required_annotations` mid-flight**: raising it reopens `completed` items below the new threshold (status is derived, so recomputation on read/transition suffices); lowering it can complete items. The recomputation is a single SQL update, tested.
* **Trace disappears or becomes unreadable** while pending: `next` returns the item, the UI detail load 404s, and the reviewer uses "skip". The queue never blocks on a missing trace.
* **Reviewers who leave the experiment**: their `claims` rows persist for history; open claims lapse by lease.
* **Bias**: ordering by `added_at` is deterministic and unbiased; random ordering is a possible per-queue option later (useful to reduce position bias in agreement studies) but not now. Random *sampling* when populating a queue (`sample: N`) is also still open: [ADR-040](adr-040-judge-human-agreement.md) recommends it to avoid selection bias in agreement studies.
* **Hand-off to ADR-038**: a "Promote completed items to dataset" action in the queue view calls the batch endpoint, so a whole review session yields one dataset version.
* **Dashboard**: new `AnnotationQueuesPage.vue` and a focused review screen (rubric on one side, trace detail on the other). It reuses the trace detail components rather than a new renderer.

## Consequences

* **Positive**: real review workflow without a scheduler or assignment UI; safe concurrent use; clean dual-store failure story; supports multi-annotator labeling needed for agreement.
* **Negative**: the largest UI piece of the whole annotation effort; the lease value (15 min) is a guess that may need tuning.
* **Negative**: pull-only means an admin cannot say "Ana reviews these 20". Deferred on purpose; assignment can layer onto `claims`.

## Out of Scope

* Auto-population by sampling or score thresholds (needs online evaluation).
* Notifications, due dates, reviewer workload dashboards.
* Adjudication of disagreements (which label becomes ground truth). Disagreement is reported in ADR-040 and resolved by a human promoting with an explicit `expectedOutput` in ADR-038.

## Implementation Checklist

- [x] `014_annotation_queues.sql` (PostgreSQL 16 in the manifests, so `NULLS NOT DISTINCT` is used) and registration in `kustomization.yaml`
- [x] Domain: derived item status function, rubric validation (pure, unit-tested)
- [x] Repository port + Postgres adapter; concurrency test for `next` (never the same item twice) and lease expiry test (`tests/integration/annotation-queues.test.ts`, opt-in with `POSTGRES_INTEGRATION_URL`)
- [x] Service `complete` with the ordered dual write and tests for each failure row above
- [x] Routes, schemas, contract, handler/schema tests
- [x] Dashboard: queues list, creation form, add-by-filter, "Add to queue" from the trace, review screen, progress/details; fakes and tests (strings are in English like the rest of the dashboard)
- [x] Docs: `docs-site/` user guide ("Reviewing traces with a queue"), API reference, access control, roadmap
- [ ] "Add to queue" from the dataset run detail page and "Promote completed items to dataset" (ADR-040 / ADR-038)
