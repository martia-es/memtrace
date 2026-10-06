# ADR-057: Business vocabulary and question templates for Custom charts

## Status
Accepted

## Context
The Custom charts builder (ADR-027, ADR-030) exposed the storage model directly: "Step type(s)" with raw values such as `llm` or `agent`, raw attribute keys (`gen_ai.tool.name`), `p50/p95` metrics and an "X axis / Series" summary. Business profiles (see ADR-052) cannot use it, and every chart started from a blank form.

## Decision
- **The saved model does not change.** `CustomMetricDefinition` still stores `step_type`, attribute keys and closed metrics, so saved charts and reports (ADR-035) keep working and renaming never breaks them.
- **Presentation goes through one pure module**, `dashboard/src/domain/custom-chart-vocabulary.ts`: step names (fixed dictionary for built-ins, automatic humanization otherwise), attribute names, metric phrasing, chart-type and name suggestions, a one-sentence description of the chart, and question templates.
- **Templates** ("Start from a question") are plain `CustomMetricDefinition`s, offered only when the required step types exist in the selected range; each custom step gets two generic questions (how often, how often it fails).
- **Flow in three steps** — what to measure, how to see it, save — with a live (debounced) preview and a suggested chart type and name that stop adapting once the person edits them.
- **Technical attributes** (`memtrace.*`, `otel.*`, `gen_ai.usage.*`, tool arguments/results…) are hidden behind "Show technical details".
- Point labels that are step types are translated at display time (`presentResult`), shared with saved reports.

## Consequences
- No API, contract or storage change; business users get a usable builder with no developer involvement.
- Names for custom steps are only humanized ("input_guardrail" → "Input guardrail"); they cannot yet be edited.
- Deliberately **not** done: asking developers to add a label in the SDK (it is easy to forget). Planned instead (iteration 2): a server-side data catalog, auto-discovered per experiment and editable from the dashboard, with the cascade *edited name → built-in dictionary → humanized id*, plus automatic classification of attributes by type and cardinality (hide ids/free text, allow numeric measures). Because the UI already consumes names only through the vocabulary module, that change swaps the source of names without touching components.
