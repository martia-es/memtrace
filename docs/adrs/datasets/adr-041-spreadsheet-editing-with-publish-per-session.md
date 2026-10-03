# ADR-041: Spreadsheet-Style Item Editing with One Version per Published Session

* **Status**: Accepted — refines [ADR-032](adr-032-automatic-dataset-versioning-and-item-audit.md) (versioning granularity) and the dashboard part of it
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-032 made versioning automatic: every add/edit/delete creates its own version. That removed the "forgot to version" trap, but the Items tab was built around it: one modal per item, three raw textareas, and one request (hence one version) per change. For the intended user — someone from the business side curating examples — this fails twice:

1. **Slow to work in.** Fixing 20 expected outputs meant 20 modals. The bar is "as fast as a spreadsheet".
2. **Version noise.** Those 20 edits produced 20 versions (`v1.1 … v1.20`), each "Edited item". The history stopped answering "what changed between the dataset I evaluated last week and today?", and the major/minor signal for run comparability was diluted.

## Decision Outcome

1. **Edit in the table, publish as one version.** The Items tab is an inline-editable grid. Everything the user types, pastes, duplicates or deletes lives in a client-side **draft**; nothing is written until **Publish**. A sticky bar shows the pending changes (`+2 added · ~1 edited · −1 deleted`) and the exact version it will create (`v3.0`). **Discard** drops the draft. The version is still never created by hand: publishing *is* the save, and the version/note are derived.

2. **One new endpoint, `POST /datasets/{id}/changes`** (session only) taking `{ add[], update[{id, …patch}], remove[] }`. The server applies it in a **single transaction** that creates **one** version:
   - bump **MAJOR** if there is any add or removal, **MINOR** if only edits (same rule as ADR-032, applied to the whole session);
   - `note` generated from the counts (`Added 3 · Edited 2 · Removed 1`);
   - removals still become tombstones and edits still set `updated_by`/`updated_at` (ADR-032 audit unchanged); an item both edited and removed in the session is just removed.
   The dataset row is locked (`FOR UPDATE`) so concurrent commits serialize; ids that are no longer active in the latest version (someone else published first) make the whole commit fail with a 400 and write nothing — the draft stays in the browser so nothing is lost.

3. **Spreadsheet ergonomics are part of the contract of this screen**: Enter moves to the next row, Shift+Enter inserts a line break, Cmd/Ctrl+Enter publishes, pasting tab/newline-separated text (Excel, Sheets, CSV copied as cells) fills cells downward and creates rows as needed, an always-present blank row at the bottom adds items, multi-select for bulk delete/duplicate, search, per-row undo. Cells are plain text; a value is stored as JSON only if it is an object/array (`4` stays the string `"4"`). Metadata and audit info move to a per-row details dialog.

4. **Unchanged**: the SDK contract (`GET/POST .../items` with its major bump per call, `?version=`), the per-item `PUT`/`DELETE` endpoints (kept for API users; they still create one version each), the Versions tab and diff (ADR-033), and run → exact version recording (ADR-034).

## Alternatives Considered

* **Server-side draft (staged changes table).** Survives closing the browser and enables collaboration, but adds schema, lifecycle and conflict states for a low-volume, usually single-editor workflow. Rejected for now; the commit endpoint is draft-storage agnostic, so this can be added later.
* **Debounced auto-publish / time-window merging of versions.** Avoids a Publish button but makes version boundaries unpredictable and non-reproducible ("why did my 10-minute session become 3 versions?"). Rejected: explicit publish gives a clear, user-meaningful version.
* **Bulk import (CSV/JSONL upload) as the main path.** Explicitly rejected by product direction: the UI itself must be at least as good as a spreadsheet, so people work *in* MemTrace rather than round-trip files. Clipboard paste covers moving data in.

## Consequences

* **Positive**: an editing session is one meaningful version; far fewer writes (one clone per publish instead of per edit — mitigates the ADR-032 negative); the business user gets a familiar, fast grid; the pending-version label removes surprise.
* **Negative**: unpublished work lives only in the browser tab (guarded by a leave/unload warning, but lost on a crash). Concurrent editors can force a "reload and retry" (stale id) — acceptable at current scale.
* **Revisit if** multi-user simultaneous editing of the same dataset becomes common (then consider server-side drafts or per-row merge).
