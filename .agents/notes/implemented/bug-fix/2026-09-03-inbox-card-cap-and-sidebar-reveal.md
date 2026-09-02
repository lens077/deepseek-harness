# Agent Note: inbox card height cap and sidebar reveal of an externally opened session

Status: implemented

English | [中文](2026-09-03-inbox-card-cap-and-sidebar-reveal.zh.md)

## Problem

Two defects in the inbox (`@deepseek-ai/dsh-client-ui-digest`) made triage confusing.

The inbox grid gave every card its natural height. A card carrying a long closing answer grew past the bottom of the panel, every other card in its grid row stretched to match, and the **打开会话** action row sat below the fold. The panel body scrolled, but reaching the actions of one card meant scrolling past a screen of text.

Opening a session from a card called `ctx.sessions.open(id)` and nothing else. The session opened in the center column, but the session browser (`@deepseek-ai/dsh-client-ui-workspace`) only auto-expanded a Workspace group that had no explicit expansion state; a group the user had folded stayed folded, a row past the **Show more** cut stayed hidden, and a nested-fork child under a folded branch stayed hidden. With multi-selection enabled the row the user had last clicked kept the stronger `.multiSelected` accent while the opened session, when visible at all, carried only the subtler `.selected` tint — the browser looked as though it had selected a session the user never opened.

## Decision

**Card cap.** `.body` in `DigestPanel.module.css` is a size query container (`container-type: size`; the flex column, not the content, sizes the box). `.card` is `box-sizing: border-box` with `max-height: calc(100cqh - 36px)` — the body's visible content height less the section label above the grid. `InboxCard` renders three flex children: the pinned head (`.cardHead`, `flex: none`), a scrolling middle (`.cardBody`, `flex: 1 1 auto; min-height: 0; overflow-y: auto`, carrying `data-card-body` and the l2 scrollbar tokens because it scrolls on the layer-1 card surface), and the pinned action row (`.cardActions`, `flex: none`). A stretched card in a grid row keeps its actions at the bottom because the middle absorbs the spare height.

**Sidebar reveal.** `SessionTree` in `WorkspaceBrowser.tsx` treats a change of `current` after the list is `ready` as a navigation and records it as `pendingReveal`; the restored session on load primes the reference without revealing. A second effect resolves the reveal one layer per render, because a folded group derives no rows and the cut and branches can only be read once it is open: it sets the group's explicit expansion to true, adds the group to the transient expand-all list when `locateSession` (`tree.ts`) places the row at or past `collapsedLimit`, removes the row's ancestors from `collapsedBranches`, and finally scrolls the row (`data-session-id` on every session row) into view with `block: 'nearest'`. Every unfold is guarded, so a row the tree cannot show settles without looping.

**Selection follows navigation.** The `WorkspaceBrowser` root treats the same `current` change — after `ready`, multi-selection enabled, not the archived view — as the selecting gesture a plain click would be and replaces the selection with `{ selected: [current], anchor: current, lead: current }` unless the selection is already exactly that row (the plain-click path sets the selection and opens in one batch, so it is a no-op there). Toggle and range gestures never change `current`, so they are untouched.

## Consequences

- Every card's action row is on screen; a long answer scrolls inside its card and the body scrolls between sections.
- A session opened from the inbox, a todo, a search hit, or a fork is visible and highlighted in the tree, and the previously clicked row loses the accent.
- Revealing writes the group's persisted expansion (`setGroupExpanded(key, true)`), so a fold the user made is undone by opening a session inside it; the transient expand-all and branch state are session-local.
- `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` pins the fold reopen with scroll, the lifted cut, the unfolded branch, the untouched fold on load, and the selection move; `tree.client.spec.ts` pins `locateSession`; `packages/client/ui-digest/tests/panel.client.spec.tsx` pins the head / body / actions split.

## Alternatives considered

- **A viewport-relative `max-height` (`100vh` minus the panel chrome)** — rejected: the chrome height varies with the workspace chip row and the error bar, and the number would drift with every header change; the body's own content height is the fact the cap depends on, and container query units read it directly.
- **Clearing the multi-selection on navigation instead of moving it** — rejected: with multi-selection enabled a plain click leaves the opened row in the accent, so a cleared selection would make an externally opened session look different from a clicked one; moving the selection makes both paths render identically.
- **Revealing from the inbox plugin through a new ui-workspace seat** — rejected: every external opener (todo, timeline, search, fork, subagent catalog) would have to call it, and a missed caller reproduces the defect; keying the reveal on the runtime's `current` fact covers every opener with no cross-plugin API.
- **Revealing on every `current` value including the one restored on load** — rejected: `current` arrives with the `pending → ready` list edge, so the restore would undo every persisted fold on each page load.
