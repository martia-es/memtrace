# ADR-027: Custom metrics on user-defined spans

## Status

Accepted — design validated against an interactive mockup of the chart builder (chart type selector, dynamic per-attribute value discovery for filtering, independent from `groupByAttribute`). The "how you create custom spans" part is implemented (see ADR-026); the Metrics dashboard part described here (endpoints, Postgres migration, dashboard panel) is not yet built.

## Context

ADR-026 established that a user can trace any non-LLM step (a guardrail check, a rules-based classifier...) as its own span, nested under whatever node runs it, using a free-form `step_type` instead of the built-in enum. That capability is only half the value: once those spans exist in ClickHouse, a user has no way to build a metric or chart out of them from the dashboard — e.g. "how many times did the input guardrail block a message, broken down by which check blocked it." Today's Metrics page (`dashboard/src/ui/pages/MetricsPage.vue`) only renders a fixed set of charts fed by one `getOverview` endpoint; it has no concept of a user-defined metric.

This ADR covers two things: how a user creates their own span trees (recap, formalized here for discoverability from the Metrics context), and a design for letting the dashboard turn those spans into a chart without MemTrace knowing in advance what custom step types exist.

## How a user creates their own spans (recap of ADR-026)

Any non-LLM step can be wrapped with `@trace_step` / `trace_step_context` (Python SDK) using a free-form `step_type` string (e.g. `"guardrail.regex_pii"`) instead of the built-in `StepType` enum. Nesting is automatic — whatever step is "current" when another step opens becomes its parent. Extra attributes (e.g. `guardrail.blocked: true`) are passed as `attributes`. See `docs-site/library/tracing.md` ("Custom step trees") for the full guide and `examples/03_langchain_agent_manual.py` for a runnable example (an input guardrail with two custom child spans, all nested under the same trace as the agent's own LLM spans).

## Data model this relies on

Everything lives in one ClickHouse table, `memtrace.otel_traces` (`migrations/clickhouse/001_init_traces.sql`). There is no separate schema per span kind:

- `SpanAttributes`: `Map(LowCardinality(String), String)`, bloom-filter indexed on keys (`idx_span_attr_key`). Holds `memtrace.step_type` (the free-form string) and any custom attribute (`guardrail.blocked`, etc.), all as text.
- `ServiceName` = experiment, `TraceId`/`SpanId`/`ParentSpanId` = hierarchy, `Duration`/`StatusCode`/`Timestamp` = the rest.

A custom step type is therefore not a distinct entity to register — it's just a value that shows up in `SpanAttributes['memtrace.step_type']`. Discovering "what custom step types has this user defined" is a `SELECT DISTINCT SpanAttributes['memtrace.step_type'] ... WHERE ServiceName = :experiment` — no migration needed to support a new one.

## Decision (proposed design)

No free-form SQL from the user: it would break the architecture's rule that all ClickHouse knowledge stays encapsulated behind the query API (piece 4), and it's an injection surface. Instead, a small declarative query shape:

1. **Step-type discovery endpoint** — `GET /experiments/:id/span-kinds?range=...`: distinct `memtrace.step_type` values seen in range, with counts. Populates a picker in the dashboard; the user never types a raw attribute key.
2. **Attribute-value discovery endpoint** — `GET /experiments/:id/attribute-values?stepType=...&attribute=guardrail.blocked&range=...`: distinct values of one attribute, scoped to the chosen step type(s), with counts (e.g. `true: 23`, `false: 789`, or whatever strings the user's own code produced — this is not limited to booleans). This is what makes filtering and grouping dynamic: the dashboard never hardcodes what values an attribute can take, it always asks ClickHouse what values actually occurred.
3. **Generic metric endpoint** — `POST /experiments/:id/metrics/custom`, body:
   ```json
   {
     "chartType": "bar",                          // bar | pie | line | number
     "stepType": ["guardrail.regex_pii"],
     "metric": "count",                           // count | avg_duration | error_rate
     "filters": [{ "attribute": "guardrail.blocked", "values": ["true"] }],   // optional: narrows the dataset
     "groupByAttribute": "guardrail.blocked",      // optional: breaks the metric down by an attribute's value
     "range": { "from": "...", "to": "..." },
     "bucketSeconds": 3600                          // only meaningful for chartType "line"
   }
   ```
   `filters` (restrict to specific values of an attribute) and `groupByAttribute` (break the result down across an attribute's values) are separate, composable concepts — a user can filter to `guardrail.blocked = true` *and* group the result by another attribute at the same time. The API (`TraceRepository`, same pattern as `getOverview`) turns this into one parameterized query; `metric`, `chartType`, `filters` and `groupByAttribute` are all closed, server-built SQL fragments chosen by the request, never string concatenation of user input into SQL — values coming from `filters`/`groupByAttribute` are bound as query parameters, not interpolated.
4. **Dashboard** — a "Custom charts" section in the Metrics page: pick a chart type → pick step type(s) (from discovery) → pick a metric → optionally filter and/or group by an attribute, whose possible values are fetched live from the attribute-value endpoint the moment an attribute is chosen → renders alongside the built-in charts. `chartType` only changes how the same query result is drawn (bar/pie/number share one shape; `line` additionally buckets by time).
5. **Persistence of chart definitions** — a new PostgreSQL table, `custom_metrics(id, experiment_id, name, definition jsonb, created_by, created_at)`, scoped by experiment like everything else in the identity store (ADR-013). Not ClickHouse: this is low-volume, transactional configuration, not trace data.

Example: "how many times did the input guardrail block, by which check" = `chartType: "bar"`, `stepType: ["guardrail.regex_pii", "guardrail.toxicity_rules"]`, `metric: "count"`, `groupByAttribute: "guardrail.blocked"`. Narrowing to only the blocked cases is the same shape with `filters: [{ "attribute": "guardrail.blocked", "values": ["true"] }]` and no `groupByAttribute`.

## Consequences

- No ClickHouse schema change is needed — the discovery and metric endpoints both read attributes generically.
- One new PostgreSQL table and two new API endpoints are needed; RBAC (ADR-013) applies to both the same way it does to every other experiment-scoped endpoint.
- The metric/chartType vocabulary starts small (`count`, `avg_duration`, `error_rate`; `bar`, `pie`, `line`, `number`) and is a closed enum on purpose — extending it is a backend change, not a security question, but it does mean a user can't express an arbitrary aggregation from the UI. This is accepted: it's the same tradeoff the existing `getOverview` endpoint already makes. `filters` and `groupByAttribute`, by contrast, are open on *values* (any string an attribute happens to hold) precisely because they're resolved dynamically via the attribute-value discovery endpoint rather than hardcoded.
- This ADR does not cover implementation; building it is a separate, explicitly-confirmed follow-up (endpoints, Postgres migration, dashboard panel).
