# ADR-023: Cross-Experiment Usage Endpoint for the Cost Comparison View

* **Status**: Accepted
* **Date**: 2026-09-28
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Every query endpoint under the pieza 4 API of consulta (roadmap Fase 1) is scoped to exactly one experiment: the route is `/api/v1/experiments/{experimentId}/...`, and `requireExperimentRead` resolves access and injects that experiment's `ServiceName` as the only filter ClickHouse ever sees. This is deliberate (ADR-013): a request never learns about data outside the one experiment it was authorized against.

The dashboard needed a token-usage comparison across all agents (= experiments, roadmap Fase 1.5 §2) a user can see, shown at the top of the Metrics page. That view has no single experiment to scope to — it exists specifically to compare several. Fetching totals experiment-by-experiment from the existing `/metrics/overview` endpoint would mean one ClickHouse round trip per experiment, defeating the point of a single-page comparison as the number of agents grows.

## Decision Outcome

Add one new endpoint, `GET /api/v1/experiments/usage`, that is authorized differently from every other query endpoint: instead of "read access to experiment X", it uses "list the experiments this user can see" (`identityRepository.listExperimentsForUser`, the same call `GET /experiments` already makes) and returns usage for exactly that set — never a caller-supplied list of experiment IDs, so it can't be used to probe experiments the caller can't see.

Underneath, `TraceRepository.getUsageByServices(serviceNames, range)` runs a single ClickHouse query (`GROUP BY ServiceName`, filtered with `ServiceName IN {names}`), not one query per experiment. `experimentId`/`name` are attached afterward in `toExperimentUsageResponse`, which zips the caller's experiment list with the query's rows by `serviceName`.

This is the first pieza 4 endpoint that legitimately spans more than one experiment. It doesn't relax anything: the set of services queried is always derived from the caller's own accessible-experiments list, resolved server-side, so the per-request authorization guarantee from ADR-013 still holds — it's just resolved once at the top instead of per experiment.

### What this does not solve

- No cost in currency — only token counts (input/output/total). Converting tokens to a price requires a per-model pricing table, deferred until there's an actual source of truth for it.
- No pagination: `listExperimentsForUser` already has no pagination, so neither does this. Fine at today's scale (a handful of experiments per org); revisit together if either becomes a problem.

## Consequences

- **Positive**: the cost-comparison view costs one ClickHouse query regardless of how many agents a user has, and reuses the existing experiment-visibility rule instead of inventing a new authorization path.
- **Negative**: pieza 4 now has one endpoint whose authorization model doesn't match the `{experimentId}`-scoped shape of every other route; a reader of `auth-context.ts` needs to know `requireExperimentRead` isn't the only pattern in use.
