# ADR 018: Span Tree Timeline Axis

## Status
Accepted

## Context

The trace detail view already shows the span hierarchy and a proportional bar for each span, but the current presentation does not make the temporal axis obvious enough when a user is trying to understand where each span starts and ends inside the trace.

The product direction in the roadmap is to make the trace experience feel closer to tools such as LangSmith or MLflow, where hierarchy and timing are readable at the same time.

## Decision

Render the span tree as a waterfall timeline with an explicit axis ruler and vertical guide lines aligned to the duration scale.

The tree will continue to use the existing span ordering and geometry from the domain layer. The UI will add:

- a top ruler that shows the trace timeline in evenly spaced ticks
- vertical guide lines inside each span row aligned to those ticks
- span bars that keep their proportional start and end positions on the same axis

## Consequences

- Users can understand start and end positions at a glance instead of estimating them from bar length alone.
- The existing trace and span contracts do not change.
- The waterfall presentation becomes the canonical way to read span timing in the dashboard, so future refinements should preserve the same axis model.

## Alternatives Considered

- Keep the current tree-only layout. Rejected because it hides the temporal structure too much for long traces.
- Move timing into a separate chart. Rejected because it splits hierarchy and timing across two visual models.
