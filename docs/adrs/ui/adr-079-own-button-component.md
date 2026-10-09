# ADR-079: One own `Button` component, no Quasar buttons

## Status
Accepted

## Context
The dashboard had no button component. 280 raw `<button>` elements used 50+ class
variants (`primary-btn`, `ghost-btn`, `adm-btn`, `small-btn`, `link-btn`, `icon-btn`,
`page-btn`…), each restyled in the scoped CSS of ~19 files, plus 16 Quasar `<q-btn>`
(restyled with `:deep()` overrides). Two implementations of the same visual button
(`.adm-btn` in `admin.css`, `.primary-btn` in `assistants/form.css`) had drifted apart.

## Decision
- UI controls are our own components (as `TextInput`, `Select`, `Modal`, `TabBar`
  already are); Quasar stays only for infrastructure (Notify, Dark, icons, layout).
- `components/Button.vue` is the only action button: `variant` = `primary | secondary |
  danger | link | icon`, `size` = `md | sm`, `loading`, `disabled`, and `to` to render a
  router link with the same look. It defaults to `type="button"`; attributes
  (`data-testid`, `aria-*`, `class`, listeners) fall through to the element.
- Layout concerns (`margin-left: auto`, `align-self`) stay in the parent via a class on
  `<Button>`; the component styles no positioning.
- A test (`Button.test.ts`) fails if a `<q-btn>` or a legacy button class reappears.

## Consequences
- One place to change the look of every button (and for per-organisation theming, ADR-019).
- Buttons that are not actions keep their own markup for now (tabs, toggle chips, row
  disclosure, vote buttons); they will move to `TabBar`/`Pill`/`Disclosure` components.
- Tests select buttons by `data-testid` or `.mt-btn.v-<variant>` instead of local classes.
