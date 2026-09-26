# ADR-016: Focus span inspector layout for trace and conversation views

- Status: Accepted (applies to the trace view only since ADR-017)
- Date: 2026-09-26

## Context

The trace and conversation detail pages were organized as a narrow left sidebar plus a large inspection area on the right, which made the span tree secondary and visually crowded. The primary task while debugging a single execution is to understand the hierarchy of spans and then inspect the selected span quickly without losing context.

The product goal is to resemble the experience of observability tools such as LangSmith and Langfuse: the execution tree stays visually dominant on the left, while the selected span presents its input, output, and metadata in a single central inspector card.

## Decision

We will use a three-part focus layout for spans and conversations:

1. A persistent left panel with the turn list and the full-height span tree.
2. A central inspector panel for the selected span, containing input, output, and metadata in the same card.
3. A smaller secondary metadata surface for detailed attributes and events when needed.

This layout keeps the hierarchy and execution timing as the primary navigation mechanism, while the content inspection remains adjacent and immediately visible.

## Consequences

### Positive

- The execution tree is easier to scan for hierarchy and errors.
- The selected span is inspected without changing screens or scrolling across multiple sections.
- Input and output stay side by side in the same focus card, which matches the mental model of a single execution step.
- The layout scales better for long traces and conversation detail views with many spans and turns.

### Negative

- A few metadata tabs become more compact because the surface is now shared with input/output.
- Some lower-priority diagnostics must be prioritized so the primary inspection card does not become overloaded.

## Design principles applied

- Prefer a single source of truth for the selected execution step.
- Keep the span tree as the dominant left navigation element.
- Minimize context switches when reading input/output/metadata for a span.

## Follow-up

If the dataset grows significantly, we can later add a split-pane resizing affordance or a compact collapsed metadata mode without changing the overall layout principle.
