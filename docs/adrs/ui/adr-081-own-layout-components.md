# ADR-081: Own `DataTable`, `Card`, `Pagination` and `FormField` components

## Status
Accepted (extends ADR-079 and ADR-080)

## Context
Listings repeated the same table CSS (header, row border, hover, sticky header) in 17 files
with slightly different heights; `.card` was redefined in 11 files; three pages carried an
identical Prev / Page n of m / Next block; and ~30 modal fields repeated `label.field` + a
`<span>` caption with their own CSS.

## Decision
- `DataTable`: the content (`thead`/`tbody`) stays in the page, so cells can hold anything;
  the component owns header, row border and hover. By default it sits in a bordered box with
  horizontal scroll; `bare` drops the box, `sticky` fixes the header inside a scrolling
  container (implies `bare`), `density="sm"` and `nowrap` adjust cells. Attributes go to `<table>`.
- `Card`: bordered surface, flex column, `padding` (`none|sm|md|lg`), `gap`, `tone="danger"`,
  `as` for the HTML tag. Pages keep their own class (e.g. `card list-card`) for local tweaks.
- `Pagination`: `v-model:page`, `pageCount` and a summary slot.
- `FormField`: label + control + optional hint/error; a `<label>` wrapping the control (or a
  `<div>` with `as="div"` for composite controls).
- Base styles use `:where()` so a page can override one property without raising specificity.
- Not migrated, on purpose: the editable grid of `DatasetItemsEditor`, the chart result tables,
  the confusion matrix, `PromptDetailPage` tables/cards, `AssistantCard` and `ApprovalFlowChart`
  (bespoke layout). A guard test fails if the old `mt-table-wrap` / `pager` markup returns.

## Consequences
- One header/row look for every listing; row heights are now content-driven (about 44 px
  instead of the fixed 44 to 50 px each page used).
- Cards that were 10 px or 6 px rounded now use the shared radius.
- `.field` captions of fields without a plain-text label (dynamic text, `for`/`id` pairs) keep
  their old markup until they are reworked.
