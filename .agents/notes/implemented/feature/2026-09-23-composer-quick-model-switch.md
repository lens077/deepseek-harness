# Agent Note: Quick model switch above the composer

Status: implemented

English | [中文](2026-09-23-composer-quick-model-switch.zh.md)

## Problem

Switching the model of a session took three presses in the composer's model seat — open the trigger, drill into the Model pane, pick a row — and a reader who alternates between two or three models for one task paid those presses every time. The `/model` popup was no shorter: type the command, wait for the catalog rows, pick one. Nothing on screen remembered which models the reader actually used, so every switch started from the whole provider-grouped catalog.

## Decision

**A strip of recently used models sits directly above the composer card,** registered by `ui-model-selection` into `conversation.input.dock` with the highest order so it is the last dock entry before the card, and gathered at the right edge so the pills stand above the model seat they shortcut. The pills stay on one non-wrapping row; when they exceed the available width, the strip scrolls horizontally with a hidden scrollbar so every route remains reachable and selectable. One pill per remembered route, the current route pressed and inert; one press on any other pill submits that route through the same per-session `ModelDirectory` the seat and the popup use, so the three entries keep one state.

**The list is a durable user preference, not a session fact.** `ui-model-selection.recentModels` in the Host settings document holds at most five routes, newest first. Every selection the Host accepts through any of the three entries is folded in by `rememberRecentModel`: the selection moves to the front and the route it replaced follows it, so the first switch already offers the way back; one entry per route keeps the effort it was last used with. A refused selection enters nothing. The list is shared by every session and changes no running session's model — selection stays per session through `session.selectModel`.

**Pills resolve against the live catalog at render time.** `quickModelChips` names each remembered route by its catalog display name and drops a route the loaded groups no longer advertise, so the strip never offers a model the Host would refuse; a remembered effort the model no longer offers is dropped so the pill submits the model's default. A strip whose every pill is the current route renders nothing.

**The strip is a General Settings toggle, on by default.** `ui-model-selection.quickSwitch` gates rendering only; the recent list keeps accumulating while the strip is off, so turning it back on shows the reader's actual history. The `QuickSwitchPolicy` mirrors `TranscriptViewPolicy`: it publishes an explicit choice before persistence settles and adopts the Host section without writing it back.

**The plugin gains a Host half.** Its previously empty node-side `apply` now registers the settings namespace, following `ui-chat`; the shared `model-selection-settings.ts` module carries the schema and the fold so both halves validate the same section.

## Alternatives considered

**Render the pills inside the model seat, above its trigger.** Rejected: the seat is one control in the composer's tool row, which centres its controls vertically; a two-row seat would push the send button and the mode chips to mid-height of a taller row, and the tool row belongs to `ui-conversation`, whose skeleton this plugin must not reach into. The dock strip is the composition path the composer already declares for entries above the card.

**Remember the list per session, from the Session's `lastUsed` projection.** Rejected: a new session would start with nothing, and the reader's habit spans sessions. The per-session projection stays what it is — the running route — and the cross-session memory lives with the other browser preferences.

**Let the reader pin routes instead of recording recency.** Deferred: pinning needs an editor, an order, and a place to put both; recency needs none and already covers the alternating-between-two-models case that motivated the strip. The README records pinning as deferred work.

**Store the list in `localStorage` to avoid a Host half.** Rejected: every other browser preference in this GUI rides the Host settings document through `ctx.settingsScope`, so the list follows the reader across browsers and appears in the settings editor with the toggle beside it.

## Testing

`packages/client/ui-model-selection/tests/model-selection-settings.client.spec.ts` registers the namespace through a real `SettingsProvider`, rejects a non-boolean toggle and a malformed route, and covers the fold: selection first with the replaced route behind, one entry per route carrying the latest effort, an effort-only change, the unchanged-reference case, and eviction past the limit. `quick-switch.client.spec.ts` covers the policy's default, optimistic publish, Host adoption, and identical-section short-circuit, and `quickModelChips` resolving names, marking the current route, and dropping retired routes and efforts. `quick-model-switch.client.spec.tsx` renders the pure strip and the dock adapter: pressed and inert current pill, locked and busy states, the empty-strip rule, the refusal toast, and the adapter's hide rules. `quick-switch-row.client.spec.tsx` covers the Settings row. `browser-plugin.client.spec.ts` gains a `settingsScope` fake and asserts the dock and Settings registrations, that a seat, popup, or strip selection lands in the same recent list, Host adoption on a fresh page, and the refusal messages.

## Consequences

- `ui-model-selection` now depends on `dsh-settings` (Host, dev-only) and `dsh-client-ui-settings` (browser, dev-only) and bundles `schemastery` for the schema; its `inject` adds `settingsScope`.
- The dock order `50` is the highest in the stack. A later dock entry that must sit below the strip needs a higher order; one that must sit above it takes anything below 50.
- The recent list is capped at five and is not configurable; the cap is a constant beside the schema with the width reasoning next to it.
- The strip's pill press has no read-back of its own beyond the directory state: a refusal shows through the transient toast anchored to the strip, and the seat's inline error strip stays the catalog-load surface.
