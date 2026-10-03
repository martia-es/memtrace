# ADR-038: Promote an Annotated Trace to a Dataset Item

* **Status**: Accepted — implemented (2026-10-03). See "Implementation notes" for where the implementation refines the text below
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-037](../evaluation/adr-037-human-annotations-storage-and-api.md). Builds on [ADR-032](adr-032-automatic-dataset-versioning-and-item-audit.md) and [ADR-033](adr-033-stable-item-identity-and-version-diff.md).

## Context and Problem Statement

The valuable loop in Langfuse, LangSmith and MLflow is: *find a bad production trace -> a human supplies the correct answer -> that pair becomes a regression test.* MemTrace has datasets (versioned, audited per item) and, after ADR-037, human labels on traces, but nothing connects them. Today a dataset item can only be created by typing JSON in the dashboard or through the SDK (`addDatasetItems`).

Promotion has non-obvious consequences with the current dataset design:

1. Every mutation creates a new `dataset_versions` row (ADR-032). Promoting 50 traces one by one would create 50 majors.
2. Items have a stable identity (`origin_item_id`, ADR-033). Promoting the same trace twice must not create two logical items.
3. A trace is not an `(input, expected_output)` pair. We must decide what is extracted and from where.
4. Trace data may be redacted or disappear (retention), so a reference to the trace is not enough.

## Decision Drivers

* No new dataset mechanics: reuse `addDatasetItems` so versioning, audit and diff keep working unchanged.
* A dataset item must be **self-contained** (it is a test fixture; it must run next year even if the source trace is gone).
* Provenance must be traceable (who promoted, from which trace, based on which label).
* Predictable semver impact (ADR-032: adding items = MAJOR).

## Decision Outcome

### Operation

A new endpoint, one call = one dataset version:

```
POST /api/v1/experiments/:experimentId/datasets/:datasetId/items/from-traces
body: {
  items: [
    { traceId: string,
      input?: unknown,                 // person-corrected input (e.g. scrubbed); replaces the extracted one
      expectedOutput?: unknown,        // human correction; if omitted see "Expected output resolution"
      fromConfigId?: string            // use this config's categorical/text label as expected output (optional)
    }, ...                              // max 100 per call
  ]
}
-> 201 { added: DatasetItem[], skipped: [{ traceId, reason: "already_promoted" | "no_content" | "not_found" | "ambiguous_label" | "unsupported_label" }] , version: {major, minor} }
```

Implemented as a new `DatasetPromotionService.promoteTraces` (see Implementation notes), which (a) loads each trace, (b) builds the item payloads, (c) calls `IdentityRepository.addPromotedDatasetItems` **once** with the whole list. Result: **one new MAJOR** per call regardless of N, with the automatic note "Added N items" (ADR-032 point 4) — extended to mention the provenance ("from traces") only if cheap, otherwise unchanged.

Dashboard: "Add to dataset" from `TraceDetailPage` (single) and, later, from a queue ([ADR-039](../evaluation/adr-039-annotation-queues.md)) in bulk. The single-trace UI must show a preview of `input` / `expected_output` and let the user edit them **before** committing.

### What is extracted from a trace

* `input`: the captured input of the **first span that has one** (`memtrace.input`, else `gen_ai.input.messages`) — the same rule as the trace list preview, but with the full content, not its 240-character preview (`TraceSummary.input`). Stored as JSON: parsed if it is valid JSON, otherwise kept as a string.
* `output` (the agent's actual answer) is **not** stored as the `expected_output`. It is stored in `metadata.observedOutput` so a reviewer can see what the agent said when it failed.
* If no span captured an input (content capture is opt-in, ADR-004; the SDK's `eval.item` spans never record content) the trace is `skipped: no_content`, unless the request supplies `input`. We never promote an empty fixture. Redaction (ADR-021) replaces secret-shaped substrings with `[REDACTED]` inside the text; that is still content and is not skipped — the preview is where a person reviews it.

### Expected output resolution (in priority order)

1. Explicit `expectedOutput` in the request (the human typed the correct answer).
2. Value of the caller-selected `fromConfigId` annotation on that trace (e.g. a `correct_answer` config). Only **categorical** configs qualify (`ScoreDataType` has no free-text type); numeric/boolean ones are `skipped: unsupported_label`. All non-retracted trace-level annotations for that config must agree; if annotators disagree, the request must pass `expectedOutput` explicitly (`skipped` otherwise, reason `ambiguous_label`). No annotation for the config falls through to 3.
3. Otherwise `expectedOutput = null`. Allowed: the item is still useful for evaluators that do not need a reference (e.g. LLM-as-judge `Faithfulness`). The UI warns about it.

Numeric / boolean verdicts ("this answer was bad") are **not** an expected output; a verdict says what is wrong, not what is right. They are copied into metadata (below) as context only.

### Provenance and self-containment

Item `metadata` (existing JSONB column, `metadata: Record<string, unknown> | null`) gets a reserved, documented key:

```json
{ "promotedFrom": {
    "traceId": "…",
    "promotedBy": "<user-id>",
    "promotedAt": "2026-10-03T10:00:00Z",
    "observedOutput": "…",
    "annotations": [ { "config": "correctness", "value": "false", "annotator": "<user-id>" } ]
} }
```

* The item content is a **copy**; deleting the trace later changes nothing.
* The annotation snapshot is a copy at promotion time and is **not** kept in sync with later edits. This is documented to users: the dataset is a point-in-time fixture.
* `promotedFrom` is reserved; the user-editable `metadata` form must preserve it when saving other keys (a test case in the item edit flow).

### Idempotency and duplicates

* An item is a duplicate if the **latest, non-deleted** version already contains an item with `metadata->'promotedFrom'->>'traceId' = :traceId`. Duplicates are `skipped: already_promoted`, not errors.
* The check and the insert must be atomic or two concurrent promotions can both pass it. `addDatasetItems` already runs in a transaction; the duplicate check runs inside it with a per-dataset advisory lock (`pg_advisory_xact_lock(hashtext(dataset_id))`). Datasets are low-volume curated objects (ADR-028), so serializing writers per dataset is acceptable.
* No unique index on the JSONB path: item rows are cloned on every version (ADR-032), so a uniqueness constraint over them would conflict with its own clones. The lock + check is the correct tool here.
* Re-promoting after the first item was **deleted** is allowed (the tombstone from ADR-032 is excluded by the `deleted_at IS NULL` filter).

### Authorization

`member` or better on the experiment can promote (consistent with who can already add items from the dashboard). Reads the trace through the tenant-scoped `TraceRepository`; a `traceId` of another tenant returns `skipped: not_found`.

## Design Implications

* **Version churn is bounded** by the batch call; the UI nudges batch promotion from queues. Single-trace promotion still costs one MAJOR each, consistent with ADR-032 ("every mutation versions").
* **Runs stay comparable**: the new MAJOR makes older `dataset_runs` explicitly non-comparable to future ones (the whole point of ADR-032), which is correct — the test set did change.
* **Diff view (ADR-033)** shows promoted items as added with their `promotedFrom` metadata, giving a natural review trail ("what did we add this week and from where").
* **No SDK change.** The SDK reads items through the existing endpoints; promoted items look like any other item. A user can pin `dataset_version` to a version before the promotion to reproduce an old run.
* **Leakage risk**: a promoted item whose input came from production can contain personal data. Promotion copies it into a long-lived fixture. The UI shows the preview precisely so a human can scrub it; automated PII scrubbing is explicitly out of scope and listed as a risk, not solved.
* **Not a feedback loop to the agent**: this ADR does nothing about the roadmap's Phase 2 learning loop. It only produces better regression data.

## Consequences

* **Positive**: closes the annotation -> regression test loop with no new dataset mechanics; full provenance; safe against trace deletion and duplicates.
* **Negative**: expected output resolution is deliberately conservative; users who annotate only with booleans must still type a correct answer to get a useful reference. This is a product truth (a thumbs-down is not a reference answer), not an implementation gap.
* **Negative**: per-dataset advisory lock serializes concurrent promotions; irrelevant at expected volume.

## Open Questions

* Allow promoting a **span** (e.g. one failed tool call) as an item? Needs a notion of per-span input/output; deferred.
* Should the SDK expose `dataset.add_from_trace(...)`? Probably no: promotion is a human, UI-driven action.

## Implementation notes

Where the implementation refines the text above:

* **Service**: `DatasetPromotionService` (new file) instead of growing `EvaluationService`, which only knows the identity and score stores; promotion also needs the trace and annotation stores. Pure logic (content extraction, expected-output resolution, metadata snapshot) lives in `domain/dataset-promotion.ts`.
* **Repository**: `addPromotedDatasetItems` runs `pg_advisory_xact_lock(hashtext(dataset_id))`, reads the `promotedFrom.traceId` values already live in the latest version, and inserts only the rest under one MAJOR version (note `Added N items from traces`). If nothing is left it creates no version (`version: null`, HTTP `200`). A repeated `traceId` inside one request is reported as `already_promoted` for the later copies.
* **`promotedFrom` is protected on the server**, not only in the form: `updateDatasetItem` and `commitDatasetChanges` merge the reserved key back into any metadata patch (`keepPromotedFrom` in the Postgres adapter), so editing or clearing other metadata keys can never drop provenance.
* **`input` override** in the request body: the preview must let a person scrub the input, and the server otherwise re-extracts it. The extracted content still supplies `observedOutput`.
* **Tenant check**: spans are filtered to the experiment's `serviceName`; a trace with none of them is `not_found`.
* **UI**: `AddToDatasetModal` on `TraceDetailPage` (single trace). Bulk promotion from a queue is still future work.
* **`eval.item` traces** need no special case: the span records no content, so they fall under `no_content`.

Tests: unit (domain, service) and dashboard (modal, preview helper) run in CI. `api/tests/integration/dataset-promotion.test.ts` (batch = one version, duplicates, delete-then-repromote, concurrency, `promotedFrom` preservation) is opt-in with `POSTGRES_INTEGRATION_URL` and **has not been run yet** against a real Postgres.

## Implementation Checklist

- [x] Pure builder in `domain/` with unit tests (JSON parse fallback, no-content skip, expected-output resolution order)
- [x] Advisory-lock duplicate check in the Postgres adapter (integration test written, pending a run against Postgres)
- [x] Route, schema, contract, mapper; service tests with fakes
- [x] Dashboard: "Add to dataset" modal with preview in `TraceDetailPage.vue`; `promotedFrom` preserved server-side on item edit
- [x] Docs: `docs-site/library/evaluation.md`, `docs-site/platform/api.md`; roadmap entry
- [ ] Bulk promotion from a queue (ADR-039) in the UI
