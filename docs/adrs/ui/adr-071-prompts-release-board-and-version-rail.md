# ADR-071: Release board for the prompt list and a vertical version rail in the prompt page

## Status
Accepted

## Context
The prompt registry (ADR-067) shows prompts in a table and, inside a prompt, a flat list of versions on the left. Both
worked with a handful of versions and fail when a prompt has dozens:

- The list says which version each tag points to, but not whether production is **behind** the latest version, which is
  the question someone opening the page has. Nothing summarises "what is live".
- The version list is one long column with no search, and the versions that matter (the ones `dev`, `pre` and `pro`
  point to) can be far down. A horizontal strip of version cards was tried in a design proposal and discarded: it does
  not scale with many versions.

## Decision
- **List page**: a *release board* on top (prompts pinned in `dev`, `pre`, `pro`, and how many prompts run behind the
  latest version in `pro`), status chips (*Behind in PRO*, *In sync*, *Not released*) and one row per prompt with its
  status, tags and a short line of its last 9 versions. Everything is derived from the data the list already returns
  (`latestVersion`, `tags`); no API change.
- **Prompt page**: the version column becomes a **rail** with a search box (by number or message), a *Pinned by tags*
  section that always stays on top, and the rest grouped by month. A strip above the tabs says what runs in each
  environment and how far production is behind. Content shows numbered lines with `{{variables}}` highlighted and the
  lines changed since the parent version; Compare, Evidence and Tags keep their data and test ids with a new layout.
- The release rules (what "behind" means, coverage per environment, timeline cells, grouping and filtering) are pure
  functions in `domain/prompt-release.ts`. "Production" is the `pro` tag and the board shows `dev`, `pre`, `pro`.
- A small `EnvFlag` component paints an environment tag (neutral for `dev`, amber for `pre`, action colour for `pro`).
- Only `--mt-*` tokens are used, so the dark theme and per-organization themes (ADR-017, ADR-019) keep working.

## Consequences
- The page answers "is production up to date?" without opening any prompt.
- The board and the status chips assume the three usual environments. An organization with other environment names
  would need the environment list in the list response; the detail page already receives `environmentKeys`.
- The rail searches the versions already loaded. With thousands of versions it will need server-side search and
  pagination, which the *Pinned* section and the grouping make easy to add without redesigning the page.
- The list does not show an excerpt of the latest text: the list response does not carry the content. Adding it would
  be an API change and is left out of this decision.
