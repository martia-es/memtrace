# ADR-051: Explicit Reviewers per Annotation Queue

* **Status**: Accepted — implemented
* **Date**: 2026-10-04
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-039](adr-039-annotation-queues.md), [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md)

## Context and Problem Statement

[ADR-039](adr-039-annotation-queues.md) lets any experiment member pull and label items from any queue; the only knob is `requiredAnnotations`, *how many* different people must label each item. The intended process has business profiles (who know what the agent should answer) label, so a queue must say **who** may annotate, not just how many.

## Decision Outcome

* Each queue has an explicit **reviewer list** (`annotation_queue_reviewers(queue_id, user_id)`, migration `017`). Only listed users can `next`, `complete` and `skip`. No role bypasses it: an `admin` or `org_admin` who is not listed cannot annotate (they still manage the queue, read progress and add items).
* **Org/experiment RBAC is unchanged.** No new role is added (the roadmap keeps 3 roles). The list is a per-queue allowlist on top of experiment membership: reviewers must already have access to the experiment: direct members **or `org_admin`s of its organization**, who enter without a membership row (validated on create and when adding people; `GET .../annotation-queues/reviewer-candidates` lists them for the picker), so a queue never grants access to the experiment.
* `reviewerIds` is required on create (at least one) and replaces the list on `PATCH`. `requiredAnnotations` may not exceed the number of reviewers, otherwise items could never complete. Both rules live in `validateNewQueue`.
* Authorization lives in `AnnotationQueueService.requireReviewer` (data-dependent check, same place as the archived-queue check) and fails with `AnnotationQueueReviewerError` -> HTTP 403.
* Removing a reviewer keeps their completed labels and claims; an open claim just expires with the 15-minute lease. Per-reviewer progress still reports everyone who ever claimed.
* **Migration**: existing queues get as reviewers the current experiment members plus anyone who already claimed an item, so running queues keep working. Admins can then narrow the list.

## Alternatives considered

* **A new `reviewer`/`business` role at experiment level**: rejected; it changes the roadmap's 3-role model for something that is per queue, and the same person may be a reviewer on one queue and not on another.
* **Per-item assignment**: rejected for now; pull-based distribution (ADR-039) stays, restricted to the allowlist.
* **Empty list = everyone**: rejected; it would make "forgot to pick reviewers" silently open the queue, which is the problem being fixed.

## Consequences

* The queue list still shows every queue to every member (read-only). A non-reviewer who presses Review gets a 403 with an explanatory message; hiding the button needs the current user's id in the list response and is left as a follow-up.
* The roles of who may promote to a dataset stay as in [ADR-050](adr-050-queue-results-and-curation-for-technical-roles.md).
