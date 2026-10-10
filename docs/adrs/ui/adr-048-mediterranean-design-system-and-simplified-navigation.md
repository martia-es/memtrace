# ADR-048: Mediterranean Design System and Simplified Navigation

* **Status**: Accepted
* **Date**: 2026-10-04
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The dashboard looked muted and monochrome (dark buttons on a pale green background, grayscale charts) and did not read as an enterprise product. It was also built for engineers: seven sections (Conversations, Metrics, Review, Datasets, Runs, Pricing, Admin), lists of eleven columns and detail pages that opened with a row of unlabelled pills. The product has two audiences using the same screens: business users who check in two or three times a day and technical users who live in it. Brand guidelines now live in [`docs/brand.md`](../../brand.md); this ADR records the design decisions that implement them.

All decisions here stay inside the dashboard (piece 5): every screen still consumes only the query API, and no endpoint changed.

## Decision Outcome

### 1. A two-colour system: turquoise for action, terracotta for highlights

| Token | Light | Use |
|-------|-------|-----|
| `--mt-accent` | `#00857f` | Buttons, links, selection. The only token an organization may override ([ADR-019](../../ui-conventions.md)) |
| `--mt-brand` | `#00b3ad` | Logo, charts, focus |
| `--mt-highlight` | `#ff6b4a` | Counters, pending work, the second logo bar |
| `--mt-ok` / `--mt-warn` / `--mt-err` | green / amber / rose | Status only, never decoration |

Neutrals carry a teal tint (`--mt-bg #f2faf9`, `--mt-line #d6e9e7`) instead of gray. Existing `--mt-*` names are kept, so every component picks up the new look without edits; new tokens (`--mt-accent-soft`, `--mt-accent-tint`, `--mt-accent-text`, `--mt-highlight-*`, `--mt-shadow-float`) were added. The dark theme ([ADR-017](../../ui-conventions.md)) is a designed set of values for the same tokens, not an inversion. Button fills meet WCAG AA with white text (`#00857f` is 4.6:1); the lighter brand teal is used only for graphics.

Chart series are `turquoise, terracotta, deep sea, sun, sand, slate` (`chart-theme.ts`, `palette.ts`), replacing the grayscale scale.

### 2. Compact, flat and slightly squarer

- Corners follow [ADR-018](../../ui-conventions.md) with new defaults: **4 px** chips and badges, **6 px** buttons and inputs, **8 px** cards. Organizations that pick a preset still override all three together; the appearance panel gained an explicit **Default** option.
- 1 px borders and no card shadows; only floating elements (menus, dialogs) use `--mt-shadow-float`.
- Plus Jakarta Sans at 13 px for text and JetBrains Mono (replacing Geist Mono) for ids, timestamps and every numeric column, so digits align. Table rows are 46–50 px with an uppercase 11 px header on a tinted background.
- Status is a chip (dot + label) in one component, `StatusChip`.

### 3. Five navigation entries instead of seven

`Overview · Conversations · Review · Evaluations · Costs`, plus **Settings** (formerly Admin) and the user menu at the bottom.

- **Overview** replaces **Metrics** (`/e/:id/overview`; `/metrics` redirects, so saved links keep working). It is also the landing page after login.
- **Evaluations** groups **Runs** and **Datasets**. They keep their own routes, detail pages and URLs; `EvaluationsTabs` switches between them and the menu entry is active for both.
- The badge on **Review** is the user's pending items, from the existing queues endpoint.

### 4. Summary first, detail on demand

- **Overview** opens with a plain-language health banner and five key figures. **Needs attention** is computed in the browser from data the overview endpoint already returns plus the queue progress: executions with errors, tools failing in ≥ 2% of calls, and items waiting for review. Each entry has a direct action.
- **Conversations** lists conversations by default (`?group=flat` for traces), with quick views (*All*, *With errors*, *Slow*) instead of a toggle and a latency dropdown. Clicking a row opens a **preview panel** with the messages; double-click or Enter opens the detail. The trace table dropped Service and Spans.
- **Trace detail** has two tabs, *Conversation* (chat view built by `traceThread` + `conversationTurns`, shared with the review screen through `ConversationThread`) and *Technical trace* (default, the existing tree and inspector).
- **Review** opens on an inbox (pending count, *Continue reviewing*) and shows per-queue progress bars. The review screen reuses the shared chat component.
- **Evaluations → Runs** lets the user tick two completed runs and deep-link to `Overview → Offline evals` with them preselected (`?tab=offline&compare=<baseline>,<candidate>`).

## Consequences

- **Positive**: one token set explains the whole look; screens answer "is it healthy?" without reading charts; the same pages serve business and technical users because depth is one click away.
- **Positive**: no API change and no new endpoint; the redesign can be reverted or evolved screen by screen.
- **Follow-up** ([ADR-049](../README.md#retired-adrs)): conversations now carry a readable title and a cost, *Needs attention* also flags traces that reviewers rated low, and the whole UI is in English with `en-US` formats. The original design shipped without these because the API did not provide them.
- **Negative**: *Needs attention* covers what MemTrace can measure today (errors, failing tools, human labels, review backlog). It has no signal from end-user ratings.
