---
description: "Shared Workspace browser and picker plugin for the dsh web client: grouped, flat, and archived Session views; selection, placement, directory, deletion, and Workspace flows."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

English | [中文](README.zh.md)

## Summary

This package lets users browse grouped or flat Session lists, choose a Workspace for a new Session, and manage Workspaces and Sessions through add, rename, reorder, search, fork, archive, and Workspace deletion. Pending interactions appear as warning dots, active scheduled tasks as alarm markers, and subagent-origin Sessions remain hidden. Canonically distinct folder paths remain separate Workspaces. Adding a Workspace requires a composed directory picker; without one, the add action is unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the sidebar to browse Workspaces and their Sessions, reorder them, and start new ones; the ＋ on a Workspace header starts a Session in that Workspace, and the ＋ on the Ungrouped header reuses or creates a blank Session outside every Workspace. Use the picker in the Session Intent hero to choose a Workspace or start without a folder. A collapsed Workspace shows five non-blank Sessions by default and keeps the selected blank **New Session** as one provisional extra row until its first prompt. The view menu and General Settings can set that count from 5 through 20 or to automatic sizing. **Show more** reveals the hidden remainder; closing and reopening the Workspace restores the folded projection.

On phones, **Workspaces** opens a full-width Workspace list with an Ungrouped group when present. Selecting a Workspace shows its Session list and a persistent **New Session** button that reuses or creates a blank Session in that Workspace without reopening the directory picker. The Ungrouped page starts an ungrouped Session. **Back** returns to the Workspace list, and selecting a Session opens the conversation. The drill-down uses the shared Session projection and ordering rather than a second Workspace account. Its header's icon-only **Search and manage** control opens the shared management browser; its accessible name identifies the action without a separate text row.

Phone management keeps search, clear, view options, and row actions at least 44px across. Session and Workspace actions stay visible without hover; search snippets wrap, and the pinned list scrolls within a bounded area so the remaining history stays reachable. Search and rename inputs use at least 16px text.

### Reordering and view options

View options combine grouped, flat, and archived views with one browser-persisted Session order per account. **Manual** and **Last updated** apply to grouped and flat views. Entering Last updated performs a complete recency sort and later user prompts or steers promote their Session once; entering Manual preserves every current position and disables later promotion. Dragging edits the current order in either mode; Manual-mode drags for real Workspaces also update the Host Session account, while Ungrouped and flat-list orders remain browser-local. Nested placement follows the same split: a real Workspace records it on its Host record, and a nested fork of an Ungrouped source is remembered in the browser-persisted view state so the child renders under its source in the Ungrouped bucket. In a collapsed group, drag boundaries follow rendered rows and place the source before intervening hidden rows, so a drag cannot hide its source. Workspace drag order is Host-durable in either Session order mode.

### Search

Collapsed search is one header action beside the view and add actions: activating it expands the field across the header. A non-blank query replaces either browsing mode with one flat result list — case-insensitive title and Workspace substring matches appear immediately, while a 250 ms debounced Host request adds ranked current-conversation content matches and snippets. Each new query aborts the preceding request; a failed content search leaves metadata matches visible with a warning. The list is capped at 20. Choosing a result clears and collapses search, opens the Session, and scrolls its row into view in the configured browsing mode; grouped browsing also expands its Workspace and the full Session list when required, for that visit only.

### Managing sessions

The Session row's Rename action opens a dialog prefilled with the display title. Fork can create a sibling or place the child under the source Session; both fork at the last completed Turn, increment the inherited title, and open the child. **Manage Session directories** keeps the primary cwd fixed and replaces the canonical list of additional writable roots for later commands. Archive hides a Session after the Workspace echo; the archived view can restore it or permanently delete its lineage after confirmation. Multi-selection supports toggle and visible-range gestures, keyboard movement, select all, batch archive, batch delete, Workspace membership changes, and optional todo creation. Workspace Delete removes the registration while its Sessions remain under Ungrouped.

### Pinned sessions

When the optional `sessionPins` seat enables pinning, a Session row menu offers **Pin** or **Unpin**, and the multi-selection context menu applies the same action to every selected Session. Wide sidebars show a recency-sorted **Pinned** area above the Workspace section; archived, blank, unknown, and subagent-origin Sessions stay out of it. Its header folds the list (the fold persists in the viewing store and shows the hidden row count) and carries a ⋯ menu that writes the same `session-pins` settings as the 置顶 settings page: **Sessions shown** (**Adaptive**, which sizes the area to its rows, or 5–20 fixed scrollable rows; default 5) and **Auto-pin** toggles for **Running**, **Completed**, and **Failed** Sessions, which the area lists beside the pinned ones without a pin mark (default running and completed; none selected lists pin marks only). **Completed** means finished and not yet handled: the list row's reminder bit or the pin provider's durable finished ids, which survive a Host restart. The provider retains unread results regardless of age and viewed-but-unhandled results within the digest's **自上次查看** window (the last 24 hours when no review is recorded). A viewed acknowledgement clears the unread reminder, not the handled or pin state; a viewed-but-unhandled row can still qualify for this area. **标记已处理** removes a result from this completed set, while the digest panel's **标记已查看** advances the review window; the [Session header action](../ui-digest/README.md#reading-and-acknowledgement) acknowledges only one reply. A row the area lists reads as pinned everywhere: its menu offers **Unpin**, which clears the mark on a pinned Session and, on a status-listed one, dismisses it from the area until its matched statuses change (a running Session dismissed comes back once it completes); **Pin** lifts the dismissal and writes the mark.

Each of the first ten rows in the area wears the keycap of the chord that opens it: pressing that chord in this browser tab opens the row exactly as a click does, without dismissing running, completed, or failed auto-pins or changing manual pin marks, and it fires only in this tab, never as an operating-system or browser-wide hotkey. The default is the digit row, `1` through `9` then `0`, one per position. The ⋯ menu's **Shortcuts** group holds **Enable shortcuts** (off keeps the bindings and hides the keycaps) and **Edit shortcuts…**, which opens an inline editor above the rows: click a position and press the key or chord to bind it (a chord bound elsewhere moves to the clicked position), Backspace clears it, Esc cancels, and **Digits 1–0** or **Clear all** rewrite the whole list. A chord the browser answers (⌘1 or Ctrl+1 tab switching, ⌘T, Ctrl+Shift+T, Alt+←, F5, and the like) or the operating system consumes (⌘Q, ⌘Space, Win+…, Alt+F4, ⌘⇧4) is not bound on the spot: the editor names the other owner and offers **Bind anyway** or **Record again**. Editing keys (Tab, Enter, Esc, Space, Backspace, Delete) and keys outside letters, digits, arrows, Home/End/PageUp/PageDown, and F1–F12 are refused. A chord without Ctrl, ⌘, or Alt is what typing produces, so it stays silent while an input, text area, or the composer has focus; one with a command modifier fires everywhere. Bindings live in this browser's persisted viewing state, not in Host settings.

### Pending interactions

Session rows render the runtime's live `pendingInteraction` classification: approvals report **Waiting for approval**, plan reviews report **Plan awaiting review**, and ordinary questions report **Waiting for answer**. Every pending interaction uses an amber warning dot that takes precedence over the running indicator.

### Session status presentation

A Session that owns a running Turn receives a low-opacity perimeter with one long highlight rotating every eight seconds. Completed reminders and a durable `sessionDigest.outcome === 'error'` use static success or error perimeters; aborted, blocked, token-limited, and interrupted outcomes are not relabeled as errors. A pending interaction suppresses the perimeter, and descendant-only activity retains its existing dot and label without marking the idle owner as running.

General Settings offers **Animation on (default)**, **Motion off**, and **Completely off**. Motion off keeps the state-colored track with no rotation. Completely off removes only the perimeter; status dots and screen-reader labels remain. The browser's `prefers-reduced-motion: reduce` media query also stops rotation while preserving the static track.

### Active Schedule markers

Grouped and flat Session rows, plus search results, show an outline alarm when `SessionSummary.projectionValues.schedule` is a non-empty array. The marker sits after the title; an ordinary row keeps its update time after the marker, while a search result has no update time. It is not a button, has no independent pointer action or tab stop, and clicking its area still opens the row. The localized tooltip and matching screen-reader label say **Has active scheduled task**.

The value is intentionally best effort for cold Sessions. An identity-matching usable projection-cache row can prewarm the alarm without opening the Session; a missing or stale cache may briefly omit or retain it. The marker means only that the current list value contains an undispatched or undeleted Schedule record. It does not report whether a Schedule runtime is live or able to wake the Session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package fills the sidebar browser and Session Intent picker slots and contributes the Session-count, multi-selection, and status-presentation rows to General Settings. `apply` uses `slots.inject()` for each declaration lifetime and re-registers after a declaring slot is restored. A persisted viewing store owns grouping, ordering, expansion, row-count, status-perimeter, pinned-area fold, auto-pin dismissal, and pinned-area shortcut preferences (the per-position chords and their switch); a separate non-persisted store owns the current multi-selection. The optional `sessionPins` seat supplies the live pin view (pinned ids, durable finished unhandled ids, area height, auto-pin statuses) and the pin, height, and status writers; `apply` mirrors that view for browser hooks and resets it when the provider is removed, and `derivePinned` unions the pin marks with the Sessions in the auto-pin statuses.

### The directory-flow hole

Each registration declares a **directory-flow child hole** (`single` kind: `conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow`) that the composed picker package's client half fills with its picking interaction — the `-native` backend's renderless OS-chooser driver, an in-app browsing dialog under a `-browse` composition. The flat **Add workspace...** action renders only while the surface's hole is occupied; an empty hole means the composition has no picking affordance. This package owns the trigger and the adoption: the occupant reports one picked path per open through the hole's owner conversation (`open`/`busy`/`onPicked`/`onCancel`/`onError`), and the owner adopts it through the object layer, selecting the committed Workspace only after its list projection has refreshed.

### View state

Once the Workspace list baseline is ready, browser-persisted expansion and Session-order records retain only current Workspace ids plus Ungrouped and the flat-list account. Only a header toggle or a Session started from a Workspace's ＋ writes that expansion record; a Workspace with no record shows expanded while it holds the current Session, and revealing a Session opened from the pinned area, digest, or search unfolds its Workspace only until the next page load, so a folded Workspace stays folded across loads. Real Workspaces initialize from `WorkspaceView.sessionIds`, while Ungrouped and the cross-Workspace flat list initialize from recency. The shared sidebar projection hides rows whose durable Session summary has `origin: 'subagent'`, and each visible ordinary row keeps the blue activity dot while any descendant reached through uninterrupted subagent-origin lineage is running; descendant-only activity never claims the own-running perimeter. The same pure derivation reads the Schedule and `sessionDigest` list projection values for grouped, flat, archived, and search nodes; the package uses only the type-only `@deepseek-ai/dsh-schedule/client` and `@deepseek-ai/dsh-session-digest/types` dependencies and imports neither feature runtime.

### Hover cards

Workspace and Session hover cards copy the value their row clips: activating a Workspace card writes its full directory path, while activating a non-blank Session card writes its full display title. A provisional blank New Session card remains read-only because its localized label is a placeholder rather than session content.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the sidebar host, the hero surface, and the picking backends.

- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.workspaces` hole.
- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the Session Intent hero's picker hole.
- [directory-picker-native](../../host/directory-picker-native/README.md) — the OS-chooser backend filling the directory-flow hole.
- [Workspace Controller](../../api/workspace-controller/README.md) — the Host mutations and framework-neutral Client projection that own workspaces and ordering.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define search depth, archive behavior, and the picking carrier; they are current package constraints.

- **No fuzzy content search or event deep links** — the content backend uses literal token/phrase matching, and selecting a result opens the Session rather than the matching event.
- **Permanent deletion is lineage-wide and irreversible** — the confirmation lists every Session that the Host will remove, and a running Agent can refuse deletion until it becomes disposable.
- **Pending user interaction is not aggregated into collapsed groups** — a waiting row inside a collapsed group lights no group-header indicator and becomes visible only after that group is expanded.
- **Pinned shortcuts are positions, not Sessions** — a chord opens whatever row sits at its position when pressed; the positions follow recency, so a newer Session entering the area moves every row below it down one position. Explicit unpinning or a status change can remove a row and shift later positions; navigation alone leaves pin membership unchanged. The conflict warning covers the common browser and desktop bindings of the detected platform, not every extension, terminal, or window-manager binding a machine may carry.
- **Native folder selection depends on the local Host carrier** — under the `-native` composition, in-process or remote browser deployments cannot open a local operating-system dialog; remote-capable picking is the `-browse` composition's in-app flow.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Controller contracts own Host mutation failures; the browser's viewing and selection stores remain Client-local and every slot registration is effect-owned.
