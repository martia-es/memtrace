# ADR-036: Score Configs (Annotation Rubrics)

* **Status**: Accepted — implemented (API + dashboard admin panel); consumed by ADR-037 once annotations land
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Part of**: human annotation, phase A. Read together with [ADR-037](adr-037-human-annotations-storage-and-api.md). Later phases: [ADR-038](../datasets/adr-038-promote-trace-to-dataset-item.md), [ADR-039](adr-039-annotation-queues.md), [ADR-040](adr-040-judge-human-agreement.md).

## Context and Problem Statement

`Score` today (`api/src/domain/evaluation.ts`) is `{ name, value: string, dataType, source, comment }`. Nothing constrains it: an LLM judge may emit `correctness` as `boolean` in one run and `numeric` in the next, and `name` is free text. For automatic evaluators this is tolerable (the code that emits them is versioned). For **humans** it is not:

1. Two annotators who both type `"tone"` can mean different scales (1-5 vs 1-10) or different categories (`formal`/`casual` vs `ok`/`bad`). Their values cannot be aggregated or compared.
2. Without a declared schema the UI cannot render the right control (toggle, slider, dropdown) and the API cannot reject invalid input (`"maybe"` for a boolean).
3. Judge-vs-human agreement ([ADR-040](adr-040-judge-human-agreement.md)) needs both sides to share a name **and** a type, and today nothing guarantees it.

Langfuse (*score configs*), LangSmith (feedback config) and MLflow (assessment names + `expectation`) all solve this with a project-level declaration of "what can be scored, and how".

## Decision Drivers

* Human labels are expensive and long-lived; a rubric change must never silently reinterpret old labels.
* Reuse the existing `ScoreDataType` (`numeric | boolean | categorical`) so a human annotation and a judge score of the same `name` are directly comparable.
* Low volume, transactional, referenced by queues and annotations -> PostgreSQL, same reasoning as datasets (roadmap, Phase 1.75, piece 15).
* Hexagonal layout: new port in `application/ports`, adapter in `adapters/outbound/postgres`, no framework imports in `domain`.

## Considered Options

1. **Free-form names, no config** (status quo). Rejected: see problem statement.
2. **Per-experiment `score_configs` table in PostgreSQL** (chosen).
3. **Per-organization shared configs.** Rejected for now: experiments are the tenant/permission boundary (`ExperimentRole`); an org-level object would need its own authorization story (`org_admin` only has `OrgRole`) and breaks the "experiment is self-contained" property datasets already have. Can be added later as a *template* that copies into an experiment without changing this schema.
4. **Store the rubric as JSON inside each annotation.** Rejected: no central place to edit, no list for the UI, no uniqueness of names.

## Decision Outcome

### Schema (`migrations/postgres/013_score_configs.sql`)

```sql
CREATE TABLE score_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  data_type     TEXT NOT NULL CHECK (data_type IN ('numeric','boolean','categorical')),
  min_value     DOUBLE PRECISION,           -- numeric only
  max_value     DOUBLE PRECISION,           -- numeric only
  categories    JSONB,                       -- categorical only: [{ "label": "formal", "value": 0 }, ...]
  description   TEXT,                        -- guideline shown to the annotator
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ,
  CONSTRAINT score_configs_shape CHECK (
    (data_type = 'numeric'     AND min_value IS NOT NULL AND max_value IS NOT NULL AND min_value < max_value AND categories IS NULL) OR
    (data_type = 'boolean'     AND min_value IS NULL AND max_value IS NULL AND categories IS NULL) OR
    (data_type = 'categorical' AND min_value IS NULL AND max_value IS NULL AND categories IS NOT NULL AND jsonb_typeof(categories) = 'array' AND jsonb_array_length(categories) >= 2)
  )
);
CREATE UNIQUE INDEX score_configs_name_active_idx ON score_configs (experiment_id, name) WHERE archived_at IS NULL;
```

The table `experiments` / `users` names must be checked against `001_init_identity.sql` at implementation time; the shape above is the contract, not a literal copy.

### Invariants (enforced in the application service, not only in SQL)

| Rule | Why |
|---|---|
| `data_type` is **immutable** after creation | Changing it would reinterpret every stored `Value` string. To "change type", archive and create a new config. |
| `min_value`/`max_value` may only be **widened** (`min' <= min`, `max' >= max`) | Narrowing could invalidate stored values. |
| Categories may be **added**; existing labels cannot be renamed or removed | Same. A label no longer wanted is hidden via archive of the whole config. |
| `name` is unique among **non-archived** configs of an experiment; an archived name can be reused | Lets a team restart a rubric without a naming graveyard. Annotations reference `config_id`, never only the name. |
| Deleting is **soft** (`archived_at`) | Annotations and queues reference the config; hard delete would orphan them. Archived configs stay readable, are hidden from pickers, and cannot receive new annotations. |

### Name collision with scores from evaluators

`Score.name` from an LLM judge (`correctness`, `faithfulness`) and a human config of the same name are **intentionally allowed to coincide**: that coincidence is the join key of [ADR-040](adr-040-judge-human-agreement.md). If `data_type` differs between the judge's score and the config, agreement is reported as `incomparable` instead of computed.

### Authorization

* Create / update / archive: `ExperimentRole = "admin"` (and `org_admin` through `ExperimentAccess`), because the rubric defines what the team's labels *mean*.
* List / read: any member.
* Reuses `AuthorizationService`; no new role is introduced.

### API (documented in `docs-site/platform/api.md` on implementation)

```
GET    /api/v1/experiments/:experimentId/score-configs?includeArchived=false
POST   /api/v1/experiments/:experimentId/score-configs
PATCH  /api/v1/experiments/:experimentId/score-configs/:configId     # description, widen range, add categories
POST   /api/v1/experiments/:experimentId/score-configs/:configId/archive
POST   /api/v1/experiments/:experimentId/score-configs/:configId/unarchive   # fails if name now taken
```

Request/response schemas are added to `adapters/inbound/http/schemas.ts` and `contract.ts`, following the existing zod + contract pattern. Error mapping: invariant violations -> `409`, shape violations -> `422`, consistent with the handlers in `api/tests/http/handlers.test.ts`.

## Design Implications

* **Value interpretation is anchored to the config at write time.** [ADR-037](adr-037-human-annotations-storage-and-api.md) copies `DataType` and `ConfigId` onto each annotation row, so even if the config row were to change in a way these rules did not foresee, each stored label still self-describes its type.
* **Categorical values are stored as the label string**, with an optional numeric `value` in the config for aggregation (ordinal categories such as `bad=0, ok=1, good=2`). Agreement metrics use the label for kappa and the numeric value only for correlation. If a category has no `value`, correlation is unavailable for that config.
* **Cross-store reference without foreign key.** Annotations live in ClickHouse and cannot enforce an FK to `score_configs`. The service validates `config_id` at write time; reads tolerate a config that has been archived. This is the same trade-off as `scores.DatasetRunId` already makes against PostgreSQL `dataset_runs`.
* **No versioning of configs.** An alternative is an immutable `score_config_versions` table (like `dataset_versions`). Rejected as over-engineering: the invariants above make the only permitted changes backward-compatible, so versioning would add storage and UI cost without preventing a failure mode that can still occur.
* **Dashboard**: a "Score configs" section under the experiment admin area (visible to members per [ADR-016](../identity/adr-016-admin-page-visible-to-experiment-members.md), editable only by admins). All strings go through the existing localization layer.

## Consequences

* **Positive**: typed, validated, comparable human labels; the UI can render the correct control per config; the contract for judge-human comparison exists before anyone annotates.
* **Negative**: an extra setup step before the first annotation. Mitigation: the trace annotation panel offers "create config" inline to admins, and members see an explanatory empty state.
* **Negative**: invariants make some corrections awkward (cannot rename a category). Accepted deliberately; the escape hatch is archive + recreate, which keeps old labels intact.

## Out of Scope / Open Questions

* Organization-level templates (see option 3).
* Free-text-only feedback without a config (a `comment` is always allowed on any annotation, but a comment-only annotation still needs a config of any type; revisit if teams ask for "notes" separate from scoring).
* Weighting or required/optional flags per config: belong to queues ([ADR-039](adr-039-annotation-queues.md)), not to the config itself.

## Implementation Checklist

- [x] `013_score_configs.sql` registered in `kustomization.yaml` (checked by `api/tests/migrations-registered.test.ts`)
- [x] Domain `ScoreConfig` + pure validation in `api/src/domain/score-config.ts` (unit-tested)
- [x] Port `ScoreConfigRepository` + `PostgresScoreConfigRepository` + `FakeScoreConfigRepository` in `api/tests/helpers.ts`
- [x] `AnnotationService` in `api/src/application/annotation-service.ts`
- [x] Routes under `score-configs/`, schemas, contract, mappers; 404/409/422 mapped in `identity-guard.ts`
- [x] Dashboard: `ScoreConfigsPanel.vue` in the experiment admin area, client in `identity-api.ts`, fakes, tests
- [x] `docs-site/platform/api.md`, `docs-site/library/evaluation.md`, roadmap

## Implementation Notes

* Existing categories also cannot change their numeric `value` (not only label): changing it would reinterpret stored correlation data.
* The categorical `CHECK` also requires `categories IS NOT NULL AND jsonb_typeof(categories) = 'array'`; without `IS NOT NULL` a `NULL` result passes a Postgres `CHECK`. Label uniqueness is enforced in the domain, not in SQL.
* Authorization reuses `canManageExperimentMembers` (admin or org_admin) for writes and `canReadExperiment` for reads, checked in the route like other identity endpoints.
* Not done: the inline "create config" shortcut in the trace annotation panel. The panel (ADR-037) only points admins to Admin → Score configs when there are none.
* Config ids that are not UUIDs resolve to "not found" (404) in the PostgreSQL adapter rather than failing the `uuid` cast.
* The migration was applied against PostgreSQL 16: the shape `CHECK` rejects categorical configs with `NULL`/non-array/single-category lists and inverted ranges, and the partial unique index allows reusing an archived name.
