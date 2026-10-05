# Query API

The dashboard's only data source. HTTP/JSON, versioned under `/api/v1`; within a version only additive changes are made. Errors use `application/problem+json` ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)). Requests need a signed-in session and are authorized per experiment.

## Experiment data

All under `/api/v1/experiments/{experimentId}`:

| Endpoint | Description |
|---|---|
| `GET /traces` | Paginated trace list. Params: `from`, `to`, `service`, `status`, `hasErrors`, `minDurationMs`, `limit`, `cursor` |
| `GET /traces/{traceId}` | A trace with its span tree |
| `GET /spans` | Flat, paginated span list |
| `GET /conversations` | Paginated conversations. Each one carries `title` (the user's first message, up to 120 characters, `null` if the agent did not capture content) and `costUsd` (`null` if none of its models has a known price) |
| `GET /conversations/{conversationId}` | Same summary and turns in chronological order |
| `GET /conversations/{conversationId}/transcript` | User/assistant messages per turn (needs captured content) |
| `GET /conversations/{conversationId}/tree` | Span tree of each turn |
| `GET /metrics/overview` | Totals, latency, time series, tokens per model, tools |

Lists are cursor-paginated: pass the `nextCursor` of a response as `cursor` to get the next page.

## Evaluation (ADR-028, ADR-031, ADR-032)

Also under `/api/v1/experiments/{experimentId}`. Unlike every other endpoint on this page, the ones marked "session or API key" also accept an agent API key (`Authorization: Bearer <key>`) instead of a session — `memtrace.eval` (see [Offline evaluation](/library/evaluation)) calls them directly:

| Endpoint | Auth | Description |
|---|---|---|
| `GET, POST /datasets` | session | List / create datasets |
| `GET /datasets/{datasetId}` | session | Dataset detail: name, run count, version count |
| `DELETE /datasets/{datasetId}` | session | Delete a dataset and, in cascade, its versions/items/runs |
| `GET, POST /datasets/{datasetId}/items` | session or API key | Items of the dataset's **latest version** (resolved server-side), or of an exact one with `?version=major.minor` (e.g. `?version=2.1`; 404 if it doesn't exist) — the only items endpoint the SDK calls. `POST` adds items and bumps the **major** version automatically (ADR-032) |
| `POST /datasets/{datasetId}/items/from-traces` | session | Promote traces to dataset items (ADR-038): body `{ items: [{ traceId, input?, expectedOutput?, fromConfigId?, queueId? }] }` (`queueId`: the review queue it comes from, stored in `promotedFrom.queueId`) (1–100). **One** new major version per call, however many traces. `input` defaults to the trace's captured input (first span that has it); `expectedOutput` is, in order, the one you send, the categorical label of `fromConfigId` when every annotator agrees, or `null`. The agent's actual answer goes to `metadata.promotedFrom.observedOutput`, together with `traceId`, `promotedBy`, `promotedAt` and a snapshot of the trace's labels. Returns `{ added, skipped: [{ traceId, reason }], version }` (`201`, or `200` when nothing was added and no version was created); `reason` is `already_promoted`, `no_content` (no input captured and none sent), `not_found` (unknown trace, or another experiment's), `ambiguous_label` or `unsupported_label` (`fromConfigId` is not categorical) |
| `PUT, DELETE /datasets/{datasetId}/items/{itemId}` | session | Edit (bumps **minor**) or delete (bumps **major**) a single item — each one creates its own version automatically, there is no separate "create version" call |
| `POST /datasets/{datasetId}/changes` | session | Publish an editing session as **one** version: body `{ add: [{input, expectedOutput?, metadata?}], update: [{id, input?, expectedOutput?, metadata?}], remove: [id] }` (ids are item ids from the latest version). Bumps **major** if anything is added/removed, **minor** if only edits; the description is generated (`Added 3 · Edited 2 · Removed 1`). All-or-nothing: if an id is no longer in the latest version (someone published first) it returns 400 and writes nothing. Returns the new items and `version`. This is what the dashboard's Publish button calls |
| `GET /datasets/{datasetId}/versions` | session | Read-only version history: `major.minor`, an auto-generated description of what changed, who, and when, plus the real `addedCount` / `modifiedCount` / `removedCount` against the previous version |
| `GET /datasets/{datasetId}/versions/{versionId}/items` | session | That version's full item set, including tombstones of items deleted in it (`deletedByEmail`/`deletedAt`) — read-only, for inspecting what changed |
| `GET /datasets/{datasetId}/versions/{versionId}/diff` | session | Item-level diff of a version against `?against={versionId}` (any other version) or, by default, the one right before it: `added` / `modified` / `removed` items with their before/after content, plus the count of unchanged ones |
| `GET, POST /datasets/{datasetId}/runs` | session or API key | List runs, or open one. The body must carry `datasetVersion` (`"major.minor"`); `complete: false` leaves it `running` to keep receiving batches |
| `POST /datasets/{datasetId}/runs/{runId}/items` | API key | Append a batch (`items`, each with its `itemIndex`, plus `complete`) to a `running` run; items may arrive in any order and resending one is idempotent; 409 if the run is already `completed` (what `memtrace.eval`'s default sink uses while the experiment runs) |
| `GET /datasets/{datasetId}/runs/{runId}` | session | Run detail: metadata plus every item's scores (`llm_judge` scores include `judgeModel` and `judgePromptHash`) and a `telemetry` object (`latencyMs`, `inputTokens`, `outputTokens`, `costUsd`) read from the item's trace, `null` when the item has no trace or it is gone |
| `GET /runs` | session | All runs of every dataset in the experiment, newest first (backs the dashboard's Runs view) |

An agent API key only resolves items/runs for the experiment it belongs to — the same key used for OTLP ingestion works here, no separate credential. The SDK never handles version ids: versions are created automatically on every item change (ADR-031, ADR-032), and the SDK can only *select* one by its `major.minor` string (`?version=` on reads, mandatory `datasetVersion` in the `POST .../runs` body so the run is recorded against it). `GET .../items` returns the `version` it served (the latest one if none was requested), and each run in the responses carries `versionMajor`/`versionMinor` and `status` (`running` | `completed`).

## Score configs (ADR-036)

Rubrics for human annotation, under `/api/v1/experiments/{experimentId}`. Anyone who can read the experiment can read them; creating, editing and archiving require the `scoreconfig:manage` permission (`technical`).

| Endpoint | Description |
|---|---|
| `GET /score-configs` | List the experiment's configs; `?includeArchived=true` includes archived ones |
| `POST /score-configs` | Create one: `{ name, dataType: "numeric" \| "boolean" \| "categorical", minValue, maxValue, categories: [{label, value?}], description? }`. `minValue`/`maxValue` are required for `numeric` only, `categories` (at least 2, unique labels) for `categorical` only |
| `PATCH /score-configs/{configId}` | Change `description`, **widen** the range (`minValue` can only go down, `maxValue` only up) or **add** categories (send the full list; existing labels and values must be unchanged) |
| `POST /score-configs/{configId}/archive`, `.../unarchive` | Hide / restore a config. Archived configs stay readable but can't receive new annotations |

`name` and `dataType` never change: to "change" them, archive and create a new config (an archived name can be reused). Errors: `409` when a rule is violated (name already used by an active config, narrowing a range, removing a category, editing an archived config), `422` when the config's shape is invalid for its type, `403` for non-admins.

## Annotations (ADR-037)

Human labels on a trace (or one span of it), under `/api/v1/experiments/{experimentId}/traces/{traceId}`. Session only (they are attributed to a person, so no agent API key). Any member can annotate.

| Endpoint | Description |
|---|---|
| `GET /annotations` | Everyone's current labels on the trace — `{ configId, configName, dataType, value, comment, spanId, annotator: {id, name}, createdAt }` — plus `scores`: the automatic scores (`code` / `llm_judge`) linked to the same trace. `annotator.name` is `null` for a former member |
| `POST /annotations` | Create or edit **your** label: `{ configId, value, comment?, spanId? }`. `spanId` omitted = the whole trace. The annotator is always you. Returns the same view as `GET` (`201`) |
| `DELETE /annotations/{configId}?spanId=` | Retract your label (`204`, idempotent). An experiment admin can retract someone else's with `&annotatorId=` |

Not under a trace: `GET /api/v1/experiments/{experimentId}/annotations/low-rated?from=&to=` returns the traces with a low human label in the range, for the dashboard's **Needs attention** (ADR-049): `{ count, items: [{ traceId, configName, value, createdAt }] }`, newest first, at most 10 items. A label is low when a boolean is `false` or a numeric value is below the midpoint of its rubric range; categorical labels never count. Any member.

`value` must fit the [score config](#score-configs-adr-036): a number inside its range, `true`/`false`, or one of its category labels. Errors: `422` invalid value, `404` unknown config, unknown trace, a trace of another experiment, or a span not in the trace; `409` archived config; `403` retracting someone else's label without being admin. Editing replaces your previous label for the same trace, span and config; labels from different people coexist.

## Annotation queues (ADR-039)

Review workflow over traces, under `/api/v1/experiments/{experimentId}/annotation-queues`. Session only. Anyone who can read the experiment can read queues; only the queue's `reviewerIds` with the `annotation:write` permission can pull, complete and skip. Creating, editing and archiving queues, adding items and marking them unreviewable need `queue:manage`; reading results and resolving need `queue:curate` (both `technical`).

| Endpoint | Description |
|---|---|
| `GET /` | Queues with progress `{ pending, completed, skipped }` and `assignedReviewers: [{ userId, name, image }]`, `isReviewer` (whether you can annotate in it) (who can annotate; no emails); `?includeArchived=true` includes archived ones |
| `POST /` | Create: `{ name, instructions?, requiredAnnotations (1–10, default 1), reviewerIds (at least `requiredAnnotations` user ids, all of them members of the experiment, see `reviewer-candidates`), rubric: [{ configId, required }] }` (`201`). Rubric configs must exist in the experiment and not be archived |
| `GET /reviewer-candidates` | Who can be assigned as a reviewer: `{ candidates: [{ userId, name, email }] }` with the experiment's members (an `org_admin` has no annotation permission, so is not listed). Needs `queue:manage` |
| `GET /{queueId}` | Queue with its rubric resolved to score configs, progress and per-reviewer counts `{ userId, name, completed, skipped, inProgress }` |
| `PATCH /{queueId}` | Change `name`, `instructions`, `requiredAnnotations`, `reviewerIds` (replaces the list), `rubric` (once the queue has items it can only grow) or `archived`. Changing `requiredAnnotations` recomputes every item's status |
| `GET /{queueId}/items` | Items in the order they were added; `?status=pending\|completed\|skipped`, `?limit=` (max 500) |
| `POST /{queueId}/items` | Add items (`201`, returns `{ added, duplicates }`, plus `sample` when sampling). Exactly one of `{ traceIds: [...] }`, `{ fromFilter: { from?, to?, status?, hasErrors?, minDurationMs?, conversationId?, limit \| sample } }` (a snapshot of the matching traces now), `{ fromRun: { datasetRunId, sample? } }` (the run's items) or `{ runItems: [{ datasetRunId, itemIndex }] }`, at most 500 each. Ids already in the queue are ignored |
| `POST /{queueId}/next` | Claim the next item for you, or get back the one you already had open. `{ item: null }` when nothing is left for you |
| `POST /{queueId}/items/{itemId}/complete` | Send your labels: `{ labels: [{ configId, value, comment? }] }`. All `required` rubric configs must be present and each value valid. Retrying the same request is safe |
| `POST /{queueId}/items/{itemId}/skip` | Give the item back to the pool for other reviewers |
| `POST /{queueId}/items/{itemId}/unreviewable` | Admin: mark the item `skipped` so it is no longer handed out |
| `GET /{queueId}/results` | Admin: for each item, every reviewer's label per rubric criterion `{ configId, status: "no_labels" \| "consensus" \| "disagreement", labels: [{ userId, name, value, comment, createdAt, isReviewer }], resolution }`, plus `needsResolution` (a disagreement without a decision) and `promotedTo: [{ datasetId, datasetName, version }]` (datasets whose latest version already holds an item promoted from the trace), the rubric `configs` and `total`. `?status=`, `?onlyDisagreements=true`, `?limit=` (max 200, default 50), `?offset=`. Numeric labels more than 1 apart count as a disagreement, like in [Agreement](#agreement-adr-040) |
| `PUT /{queueId}/items/{itemId}/resolution/{configId}` | Admin: the technician's decision for one criterion, `{ value, expectedOutput? }`; creates or replaces it. Reviewers' labels are never modified |
| `DELETE /{queueId}/items/{itemId}/resolution/{configId}` | Admin: remove the decision (`204`) |

To know which queues hold a trace, `GET /api/v1/experiments/{experimentId}/traces/{traceId}/queues` returns `{ items: [{ queueId, queueName, archived, itemStatus }] }`. Any member.

`sample` is `{ size, seed? }` (`size` 1–500): a random sample drawn on the server. `fromFilter` takes exactly one of `limit` (the first matches) or `sample` (drawn from up to the 5,000 most recent matches); `fromRun` without `sample` takes every item and is refused above 500. Without `seed` the server picks one; the response carries `sample: { seed, size, poolSize, truncated }`, and sending the same `seed` again reproduces the sample (`truncated` means more traces matched than the 5,000 read). Queue items expose `population` (`manual`, `filter` or `random_sample`).

An item is `completed` once `requiredAnnotations` different reviewers have completed it. A claim you never finish stops counting after 15 minutes. Labels are saved as annotations ([ADR-037](#annotations-adr-037)), so they appear on the trace like any other. Errors: `403` pull, complete or skip by someone who is not in `reviewerIds`; `404` unknown queue, item or experiment; `409` archived queue, name already used by an active queue, removing a config from a started queue, completing or skipping an item you haven't pulled, completing an item marked unreviewable; `422`/`400` invalid labels, unknown or foreign traces, runs or run items.

## Agreement (ADR-040)

How well the LLM judge matches human labels, and how well humans match each other. Read-only; any member. The scope is always one run or one queue, never the whole experiment, so a result describes one population.

| Endpoint | Description |
|---|---|
| `GET /api/v1/experiments/{experimentId}/agreement/judge-human?datasetRunId=<id>` or `?queueId=<id>` | Per evaluator name present on both sides. `?name=` limits to one |
| `GET /api/v1/experiments/{experimentId}/agreement/inter-annotator?queueId=<id>` | Agreement between the people who labeled the queue's items. `?name=` limits to one rubric |

`judge-human` returns `{ scope: { type, id, traceTargets }, metrics, unmatched: { judgeOnly, humanOnly } }`. Each metric has `name`, `dataType`, `status` (`ok`, `incomparable`, `mixed_judges`), `judge` (`{ model, promptHash }` or `null`), `n`, `excluded { ties, noHuman, noJudge, invalid }`, `percentAgreement`, `lowSample` (fewer than 20 compared items) and `disagreements: [{ target: "run:<runId>:<itemIndex>", judge, human }]` (at most 100). Boolean and categorical metrics add `kappa` (`null` with `kappaReason: "no_variance"` when undefined), `confusion { labels, matrix }` (rows human, columns judge) and, for boolean, `binary { tp, fp, fn, tn }` with the human as reference. Numeric metrics add `mae`, `pearson`, `spearman` and `withinOne`. Only `llm_judge` scores are compared; scores are paired by `(run, item index)` and name, and the human value of an item is the majority label (numeric: the mean). With `queueId`, only the queue's run items are paired and only labels made with the queue's rubric count; `traceTargets` counts trace items that cannot be paired. For a queue, `scope.population` is `{ manual, filter, randomSample }`: how its run items were chosen (see `population` under [Annotation queues](#annotation-queues-adr-039)).

`inter-annotator` returns `{ scope, metrics: [{ name, dataType, annotators, n, pairs, meanPairwiseKappa | meanPairwiseSpearman, lowSample }] }`, with `n` the items labeled by at least two people. Errors: `400` when the query does not name exactly one of `datasetRunId` / `queueId` (or the ids are malformed); `404` unknown run or queue.

## Cross-experiment usage

| Endpoint | Description |
|---|---|
| `GET /experiments/usage` | Token totals per experiment, for every experiment you can access. Params: `from`, `to` |

Unlike the endpoints above, this one isn't scoped to a single `{experimentId}` — it returns one row per experiment you have access to, for the cost comparison view on the dashboard's Overview page (see ADR-023, `docs/adrs/api/adr-023-cross-experiment-usage-endpoint.md`, for why this is the one exception to per-experiment scoping).

## Identity

| Endpoint | Description |
|---|---|
| `GET /me` | Current user |
| `GET, POST /organizations` | List / create organizations |
| `GET /experiments` | Experiments you can access, with `myRole` and your effective `permissions` |
| `POST /organizations/{organizationId}/experiments` | Create an experiment (`org_admin`) |
| `GET, POST /organizations/{organizationId}/members` | List / invite `org_admin`s |
| `GET /organizations/{organizationId}/identity` | Groups claim, group mappings, SCIM tokens (no secrets) and SCIM base URL. `org_admin` |
| `PATCH /organizations/{organizationId}/identity` | `{ groupsClaim }`: claim of the sign-in token that carries the groups |
| `POST /organizations/{organizationId}/identity/mappings` | `{ externalGroup, experimentId \| null, role }`: a group gives a role (`null` = organization role) |
| `DELETE /organizations/{organizationId}/identity/mappings/{mappingId}` | Remove a mapping |
| `POST /organizations/{organizationId}/identity/scim-tokens` | Create a SCIM token (plaintext shown once); `DELETE .../scim-tokens/{tokenId}` revokes it |
| `GET, POST /experiments/{experimentId}/members` | List / invite experiment members. `role` is `technical` or `business`. Requires `member:manage` (`org_admin`) |
| `GET, POST /experiments/{experimentId}/api-keys` | List / create agent API keys. `technical` sees and creates their own; `org_admin` sees all |
| `DELETE /experiments/{experimentId}/api-keys/{keyId}` | Revoke a key |

## SCIM 2.0

For your identity provider, under `/api/scim/v2`, authenticated with `Authorization: Bearer <scim token>` (one token belongs to one organization). Content type `application/scim+json`. See [Your identity provider](/platform/access-control#your-identity-provider-entra-id-okta-sailpoint).

| Endpoint | Description |
|---|---|
| `GET /ServiceProviderConfig` | What this server supports |
| `GET, POST /Users` | List (`?filter=userName eq "x"`, `startIndex`, `count`) / create. `userName` is the sign-in email. `409` if it already exists |
| `GET, PUT, PATCH, DELETE /Users/{id}` | PATCH `active: false` (also as `"False"`) removes the roles SCIM gave; DELETE removes the user and those roles |
| `GET, POST /Groups` | List (`?filter=displayName eq "x"`) / create with `members` |
| `GET, PUT, PATCH, DELETE /Groups/{id}` | PATCH `add`, `remove` (also `members[value eq "id"]`) and `replace` members |

## Ingest and health

| Endpoint | Description |
|---|---|
| `POST /ingest/v1/traces` | OTLP/HTTP gateway; requires an agent API key (see [Authentication](/library/authentication)) |
| `GET /health`, `GET /health/ready` | Liveness / readiness |
