# ADR-080: Own `Checkbox`, `Radio` and `Pill` components

## Status
Accepted (extends ADR-079)

## Context
After `Button`, the next duplicated controls were 19 raw checkboxes and 3 radios (each with
its own markup and no shared look) and six pill systems (`mt-pill` in `app.css`, `adm-pill`
in `admin.css`, plus local `.pill`, `.chip`, `.tag`, `.badge`) that coloured status with
class names such as `ok`, `warn`, `unset` or domain values (`org_admin`, `in_sync`).

## Decision
- `Checkbox`: boolean or array `v-model` (with `value`), also the `:checked` + `@change`
  pattern. With slot content it wraps control and text in a `<label>`; without it, it is only
  the control (table cells, rows already inside a `<label>`). `variant="switch"` draws a toggle.
  Attributes go to the `<input>`; `class`/`style` go to the root.
- `Radio`: same contract with `value` and `v-model`.
- `Pill`: `tone` = `neutral | ok | error | warn | info | highlight | accent`, plus `outline`,
  `mono`, `dot`. Tone styles use `:where()` so page-local variants still win. `StatusChip` is
  now a `Pill` with a dot.
- Colour is chosen by passing a tone, never by a class named after a domain value. Domain
  to tone mapping lives in small functions (`aggregatePillTone`, `roleTone`, `USAGE_TONE`).
- Tests fail if a raw checkbox/radio or a `mt-pill`/`adm-pill` class reappears.

## Consequences
- One look for form toggles and for status labels, themable in one place (ADR-019).
- Admin role pills lose their slightly different padding/radius and adopt the shared one.
- Not migrated yet because they are not status pills: text tags (`.tag` in `MessageBlock`,
  `PromptEditor`, `ApprovalFlowChart`), toggle chips, numbered badges and the `AssistantCard`
  chips with icons. They need their own components (`Tag`, `ToggleChip`, `Badge`).
