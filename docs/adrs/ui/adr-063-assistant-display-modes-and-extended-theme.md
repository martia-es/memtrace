# ADR-063: Assistant Display Modes and Extended Organization Theme

* **Status**: Accepted
* **Date**: 2026-10-07
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-019 limited the organization theme to an accent color and a corner style and said a font or more dimensions would need their own ADR. Organizations also want the "Talk" chat (ADR-055) to look like part of their brand and to choose how it is shown: it was only a floating window.

## Decision Outcome

### 1. Theme grows inside the same JSONB, as design tokens

`organizations.theme` gets: `secondaryColor`, `fontPreset`, `assistantName`, `assistantDefaultMode`, `assistantAllowedModes`. No migration: the column is JSONB and the repository normalizes missing keys to `null` (legacy bodies and rows keep working). `null` always means "MemTrace default".

- **Secondary color** overrides `--mt-highlight` (the warm accent); its soft and ink variants are derived with `color-mix`, so it follows light/dark.
- **Font** is a closed list of system stacks (`system`, `serif`, `humanist`) that overrides `--mt-sans`. No arbitrary fonts and no external font loading (CSP, privacy, performance). Default stays Plus Jakarta Sans.
- **Not configurable, on purpose**: the MemTrace logo/favicon, and span/chart colors (`palette.ts`) — they are MemTrace's identity (ADR-019).
- **Text size / density were considered and dropped**: most components use fixed px sizes, so a base size would only affect part of the UI. It needs spacing tokens first.

### 2. One function maps theme → CSS variables

`themeCssVars(theme)` returns the variables a theme sets. `applyOrganizationTheme` writes them on `:root`; the appearance form binds the same object to its live preview. Components only consume `var(--mt-*)`, so the chat (bubbles, header, input, radius, font) follows the theme with no per-component logic.

### 3. Three display modes for the assistant

| Mode | Behavior |
|---|---|
| `bubble` | Floating window bottom-right (the previous behavior). |
| `dock` | Side panel, a flex child of the app shell: it pushes the content instead of covering it. |
| `fullscreen` | `/assistant` route in a **new tab** (bare layout, session required, loads the org theme itself). |

The conversation (`AssistantChat.vue`) is written once; `AssistantChatDock.vue` is the shell for bubble/dock and `AssistantFullscreenPage.vue` for full screen. Opening full screen from an ongoing conversation hands it over through `localStorage` (read and deleted by the new tab), so context is kept.

### 4. Two levels of choice, resolved by a pure function

`resolveMode(theme, userMode)`: the user's preference if the organization allows it; else the organization's default if allowed; else the bubble, or the first allowed mode. `org_admin` sets default and allowed modes in Settings → Appearance (same `PATCH /organizations/:id/theme` and `canManageOrganization` check). The assistant display name (`assistantName`) replaces the agent name in the chat header.

`useChatDock().open` resolves the mode synchronously from themes cached by `MainLayout` (from the experiments list it already loads), because `window.open` for full screen must run inside the click gesture or the browser blocks it.

## Consequences

- **Positive**: no new store or migration; a single token mapping serves the app, the chat and the preview; the chat is branded for free.
- **Negative**: the user's mode preference lives in `localStorage` (per browser), not in their profile; moving it server-side needs a user-preferences table, left for later.
- **Negative**: the conversation hand-over to the full-screen tab is a one-time copy, not a live sync between tabs.
- **Negative**: the assistant avatar and custom welcome message are not included yet.
