# ADR-083: Own interaction widgets and no Quasar visual components

## Status
Accepted (extends ADR-080, ADR-081 and ADR-082)

## Context
After the first three phases the dashboard still mixed Quasar widgets (`q-menu`, `q-tabs`,
`q-tab-panels`, `q-dialog`, `q-banner`, `q-avatar`, `q-badge`, `q-tooltip`, `q-spinner`,
`q-card-section`) with hand-made equivalents: tab buttons written inline, segmented groups
styled by a global `.mt-segmented` class, toggle chips, collapsible sections, and a second
card system (`.mt-card` as a global utility, 39 usages) next to our `Card`.

## Decision
- New components: `Spinner` and `LoadingState`, `TabPanel` (lazy mount, then only hidden, so a
  tab keeps its state like Quasar's keep-alive), `SegmentedControl` (single or `multiple`
  selection, optional counts, `tabs` mode), `ToggleChip`, `Disclosure` (state owned by the
  caller), and `Menu` (popover opened by its parent element, rendered in `<body>` with fixed
  position, closed by outside click, Esc or `autoClose`).
- `Modal` gains a `footer` slot for actions; `TabBar` gains per-tab `data-testid`, textual counts
  and a `trailing` slot.
- The global `.mt-card` utility is gone: every usage is a `Card` (`block` keeps the old
  non-flex layout for containers with their own layout).
- Quasar remains only for the page shell (`q-layout`, `q-page-container`, `q-page`), icons
  (`q-icon`) and the `Notify`/`Dark` plugins. A guard test fails if another `<q-*>` component
  is added.
- Status-like labels (dataset row badges, I/O badge, access type, feedback) use `Pill`.

## Consequences
- One implementation of each interaction pattern; behaviour and look change in one place.
- `Menu` has no collision handling beyond clamping to the viewport and closes on resize.
- Action buttons are all `Button` (icon, link, primary, danger…); menu options are `MenuItem`;
  segmented and tab-like groups are `SegmentedControl`; filter chips are `ToggleChip`.
- A raw `<button>` is still allowed in two cases, listed with a reason in `Widgets.test.ts`:
  the internals of the interaction components themselves, and pieces whose whole row or card is
  the button or that have a bespoke design (popover triggers, expandable rows, sortable headers,
  keyboard-shortcut answer choices, OAuth provider buttons). The test fails for any other file.
