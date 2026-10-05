# ADR-050: Queue Results and Curation for Technical Roles

* **Status**: Accepted — implemented (2026-10-04). See "Implementation notes" for where the implementation refines the text and what is deferred
* **Date**: 2026-10-04
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-037](adr-037-human-annotations-storage-and-api.md), [ADR-039](adr-039-annotation-queues.md), [ADR-051](adr-051-explicit-queue-reviewers.md), [ADR-040](adr-040-judge-human-agreement.md), [ADR-038](../datasets/adr-038-promote-trace-to-dataset-item.md), [ADR-048](../ui/adr-048-mediterranean-design-system-and-simplified-navigation.md)

## Context and Problem Statement

The intended process is:

1. The agent emits traces.
2. A technical profile creates a queue.
3. Business profiles (who know what the agent should answer) label the traces against the rubric.
4. **The technical profile looks at everything that was labelled and decides what becomes a dataset item for the next evaluation.**

Steps 1-3 work. Step 4 does not, because the queue detail (`QueueDetailModal.vue`) only shows:

* aggregate numbers (progress, per-reviewer counters, kappa, judge verdict),
* a list of items with a status pill, and
* a batch **Promote to dataset** that sends every reviewed trace.

Consequences today:

* The technician **cannot see what each reviewer answered per item**. The labels are only reachable by opening each trace and its Annotate panel.
* **Disagreements are only counted**. Promotion silently skips items where reviewers disagree (`ambiguous_label`), so the cases most worth a human decision are the ones that get dropped.
* **There is no item-by-item selection**, and no place to fix the final value or the expected output when reviewers disagree.
* Business users have no clear end state: after the last item the review page just empties.

## Decision Drivers

* Roles stay separated: business labels, only technical roles promote (see `annotation-queue-roles` project memory; ADR-039 authorization: `admin` manages, `member` reviews).
* Do not duplicate label data: labels stay in ClickHouse `annotations` (ADR-037), queue state stays in PostgreSQL (ADR-039).
* The reviewers' labels must stay untouched evidence. A technician's decision must not overwrite them.
* Reuse ADR-038 promotion (one new dataset major per batch, `promotedFrom` provenance, no double promotion).
* Who may review is decided by the per-queue reviewer list ([ADR-051](adr-051-explicit-queue-reviewers.md)); this ADR does not change it.

## Decision Outcome

### 1. A "Results" view per queue, visible to admins only

The queue page for admins gets three tabs: **Summary** (what Details shows today, reordered), **Results** (new) and **Settings** (rubric, instructions, reviews per item, add traces). Members keep the current review screen only.

**Results** is a table with one row per item and one column per rubric criterion. Each cell lists every reviewer's label and comment. Labels from users later removed from the reviewer list stay visible (ADR-051 keeps them), marked as "no longer a reviewer". Rows can be filtered (all / only disagreements / not yet in a dataset). A side panel per item shows the conversation, the agent's reply and each reviewer's label with its comment, and links to the technical trace.

A disagreement is defined by one pure domain function reused by this view, by ADR-040's agreement list and by promotion, so the three never disagree about what "disagreement" means: categorical/boolean labels differ, or numeric labels differ by more than 1 (ADR-040).

### 2. The technician's decision is stored separately from the labels

A new PostgreSQL table holds the adjudication:

```sql
CREATE TABLE annotation_queue_resolutions (
  queue_item_id   UUID NOT NULL REFERENCES annotation_queue_items(id) ON DELETE CASCADE,
  config_id       UUID NOT NULL REFERENCES score_configs(id),
  value           JSONB NOT NULL,          -- final value chosen by the technician
  expected_output TEXT,                    -- optional: correct answer typed by the technician
  resolved_by     UUID NOT NULL REFERENCES users(id),
  resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_item_id, config_id)
);
```

* Reviewer labels in `annotations` are **never modified**. The resolution is a separate, attributed layer.
* A resolution is only needed when reviewers disagree or when the technician wants to override. When all reviewers agree, the consensus value is used implicitly.
* The expected output is typed by the technician, in line with ADR-038: an observed output or a label says what is wrong, not what is right.

Rejected: writing the technician's value as one more annotation in `annotations`. It would distort the agreement metrics of ADR-040 (the technician would count as a reviewer) and mix evidence with decision.

### 3. Promotion operates on a selection and uses resolved values

Promotion from the queue changes from "all reviewed traces" to "the selected rows":

* The dashboard sends the selected, ready rows to the **existing** `POST .../datasets/:datasetId/items/from-traces` endpoint (ADR-038), which already accepts `expectedOutput` per trace. No new promotion endpoint and no change to the SDK-facing contract.
* Per row, the expected output is, in order: the `expectedOutput` the technician typed when resolving; otherwise the final value (resolution or unanimous consensus) of the categorical config chosen as the reference; otherwise empty.
* A row is selectable only if it is a `completed` trace item without an open disagreement. Rows with a disagreement and no resolution are shown with **Resolve** instead of being silently dropped.
* ADR-038 rules are unchanged: copy of input, `promotedFrom`, one new dataset major per batch of up to 100, `already_promoted` skipped and reported.

### 4. API

```
GET    /experiments/:id/annotation-queues/:queueId/results?status=&onlyDisagreements=&limit=&offset=
         -> { configs, total, items: [ item + needsResolution + criteria: [{ configId, status, labels[], resolution }] ] }
PUT    /experiments/:id/annotation-queues/:queueId/items/:itemId/resolution/:configId   body { value, expectedOutput? }
DELETE /experiments/:id/annotation-queues/:queueId/items/:itemId/resolution/:configId   (204)
```

`results` is the only read that joins both stores. It does so in a bounded number of queries, not one per item: item ids and resolutions from PostgreSQL, then all labels of the queue's traces (or runs) from ClickHouse in a single `IN` query, merged in `AnnotationQueueService.getResults`. Filtering and paging happen in the service (a queue lists at most 500 items) because "disagreement" depends on the labels; `limit` defaults to 50 and is capped at 200.

All three require `admin`. Members never receive other reviewers' labels from this endpoint.

### 5. Business-side completion state

Only a small addition, with no new data:

* The **Review** entry lists, first, the queues where the current user is a listed reviewer ([ADR-051](adr-051-explicit-queue-reviewers.md)) and has pending work, each with a direct **Review** button. Queues where the user is not a reviewer are not offered a Review button. This needs the current user's id (or an `isReviewer` flag) in the queue list response, the follow-up ADR-051 left open.
* When `next` returns nothing for that member, the review page shows "You have finished your part. The technical team will see the results" and a link back to the list, instead of an empty page. Members do not see the Results tab nor **Promote**.

### 6. Where the dashboard changes

| Area | Change |
|---|---|
| `QueueDetailModal.vue` | Summary / Results / Settings tabs for admins; people who only review keep the summary |
| `QueueResults.vue` (new) | The Results table, the resolve panel and the selection-based promotion; replaces `PromoteQueueToDataset.vue` |
| `AnnotationQueueReviewPage.vue` | Already shows "Nothing left to review here" when `next` returns nothing |

## Consequences

**Positive**

* The technician can see every reviewer's answer per item, decide on disagreements and choose what goes into the dataset, in one place.
* Evidence (labels) and decision (resolution) are separated, so ADR-040 metrics stay valid.
* Disagreeing items stop being silently lost.

**Negative / costs**

* A new table and a cross-store read that must stay bounded (paged, batched).
* One more concept for the technician (resolution) next to labels.
* Results of a queue with `required_annotations > 1` can be wide; the table needs column and row virtualization if rubrics grow large.

## Out of scope

* **Per-item assignment.** Reviewers are assigned per queue ([ADR-051](adr-051-explicit-queue-reviewers.md)); items are still pulled by the listed reviewers ([ADR-039](adr-039-annotation-queues.md)).
* Online/live sampling of traffic into queues (excluded by the roadmap for this phase).
* Editing reviewer labels on behalf of reviewers.

## Implementation notes

* **Disagreement rule** lives in `domain/queue-results.ts` (`hasDisagreement`: categorical/boolean differ, numeric range above 1, the ADR-040 threshold). The dashboard mirrors the readiness/expected-output rules in `domain/queue-promotion.ts`.
* **Resolutions** are stored in `annotation_queue_resolutions` (migration `018`), keyed by `(queue_item_id, config_id)`, with value validated against the rubric config.
* **Promotion needed no new endpoint**: `from-traces` already takes `expectedOutput` per trace, so the planned `itemIds` body was dropped. This also settles the open question about the SDK contract: nothing changed there.
* **Run items** appear in Results (their labels are read with `listForRuns`) but cannot be promoted from here, as before.

### Follow-ups (implemented 2026-10-04)

* **"→ Dataset X v3.0" badge** on each Results row: `results` now returns `promotedTo` (datasets whose *latest* version holds a live item with `promotedFrom.traceId` = the trace), from `IdentityRepository.findPromotedTraces`, one query per page.
* **`promotedFrom.queueId`**: `from-traces` accepts an optional `queueId` per item and stores it. It is provenance only and is not verified. The resolver is **not** copied: who decided what stays in `annotation_queue_resolutions`.
* **"In review queues"** in the trace's Annotate panel: `GET .../traces/:traceId/queues` (any member), from `AnnotationQueueRepository.listQueuesForTrace`.
* **Annotate in Conversations**: the table view of a conversation has an **Annotate** button per turn that opens the same panel in a modal.
* **Review button only for reviewers**: the queue list returns `isReviewer` for the caller; the button and the sidebar badge ignore queues where the user is not listed ([ADR-051](adr-051-explicit-queue-reviewers.md)).
