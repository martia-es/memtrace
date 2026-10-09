# ADR-079: Making the Data Catalog Discoverable

* **Status**: Accepted
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-078](adr-078-editable-chart-catalog.md)
* **Related**: [ADR-059](adr-059-sidebar-submenus-instead-of-page-tabs.md)

## Context and Problem Statement

ADR-078 shipped the editable catalog (names and visibility of steps and attributes) behind a small text link, "Rename things", inside the label of the "I want to see…" field of the Custom charts builder. In practice nobody found it: it was tiny, it only existed inside one tab, and the people it was built for (business profiles) do not go looking for settings inside a chart builder. A feature that cannot be found does not exist.

## Decision Outcome

No new storage, API or permission. The three surfaces below are views over the same catalog (`catalog:manage` to edit, `experiment:read` to see) and share one component.

1. **One table component** (`ChartCatalogTable`) holds the editing logic that used to live inside the modal. The modal ("Customize names") and the new page are thin wrappers around it, so there is a single place where names are validated, saved and reset.
2. **In-place rename in the builder.** Each step chip gets a pencil; Enter saves, Esc cancels, an empty name goes back to the automatic one. Renamed chips have a dashed outline so it is visible that the name is not the one the code chose. The "Rename things" link becomes a labelled button with an icon, "Customize names", and a "Manage all names and details" link goes to the page.
3. **A page, Overview › Data catalog** (`/e/:experimentId/overview/catalog`), as a child of Overview in the side menu (ADR-059). It shows the same table at full width with a search box that matches the technical key, the edited name and the automatic name. People without `catalog:manage` can open it read-only, which also tells them why they cannot edit.

In-place editing covers steps only; attributes need more than a name (visibility, kind, distinct values), so they stay in the table.

## Considered Options

* **Only a more visible button.** Cheap, but it still hides the catalog inside one tab and gives no overview of what exists.
* **Only a page.** Good for administering, but a person who sees a badly named step in the builder would have to leave the flow to fix it.
* **Rename attributes in place too.** Rejected for now: the attribute pickers (split by, filters) are dense, and the visibility decision does not fit a pencil.

## Consequences

* Easier: finding the catalog from the side menu and from the step itself; renaming one step takes two clicks.
* Harder: nothing structural. The modal and page must keep sharing the table; a change in one is a change in both.
* Not done: sections of the page per step (attributes grouped under the step that reports them). Attributes are still a flat list because the discovery endpoint returns keys for a set of steps, not per step.
