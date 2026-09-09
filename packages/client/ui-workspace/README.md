---
description: "Shared Workspace browser and picker plugin for the dsh web client: grouped, flat, and archived Session views; selection, placement, directory, deletion, and Workspace flows."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-workspace` is the shared Workspace browser and picker of the dsh Web client. Users browse grouped, flat, or archived Session rows; start a Workspace-backed or ungrouped scratch Session; and manage Session placement, selection, directories, archive state, and permanent deletion. Pending user interactions surface as amber warning dots; active, completed, and failed Sessions can add subdued status perimeters; active Schedule projections surface as non-interactive alarm markers; nested forks render under their selected parent; and the shared sidebar projection hides subagent-origin Sessions. Distinct canonical paths remain separate id-keyed Workspaces, and folder choices go through child slots filled by a composed picker package.

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

On phones, **Workspaces** opens a full-width Workspace list with an Ungrouped group when present. Selecting a Workspace shows its Session list; **Back** returns to the Workspace list, and selecting a Session opens the conversation. The drill-down uses the shared Session projection and ordering rather than a second Workspace account. Its header's icon-only **Search and manage** control opens the shared management browser; its accessible name identifies the action without a separate text row.

### Reordering and view options

View options combine grouped, flat, and archived views with one browser-persisted Session order per account. **Manual** and **Last updated** apply to grouped and flat views. Entering Last updated performs a complete recency sort and later user prompts or steers promote their Session once; entering Manual preserves every current position and disables later promotion. Dragging edits the current order in either mode; Manual-mode drags for real Workspaces also update the Host Session account, while Ungrouped and flat-list orders remain browser-local. Nested placement follows the same split: a real Workspace records it on its Host record, and a nested fork of an Ungrouped source is remembered in the browser-persisted view state so the child renders under its source in the Ungrouped bucket. In a collapsed group, drag boundaries follow rendered rows and place the source before intervening hidden rows, so a drag cannot hide its source. Workspace drag order is Host-durable in either Session order mode.

### Search

Collapsed search is one header action beside the view and add actions: activating it expands the field across the header. A non-blank query replaces either browsing mode with one flat result list — case-insensitive title and Workspace substring matches appear immediately, while a 250 ms debounced Host request adds ranked current-conversation content matches and snippets. Each new query aborts the preceding request; a failed content search leaves metadata matches visible with a warning. The list is capped at 20. Choosing a result clears and collapses search, opens the Session, and scrolls its row into view in the configured browsing mode; grouped browsing also expands its Workspace and the full Session list when required.

### Managing sessions

The Session row's Rename action opens a dialog prefilled with the display title. Fork can create a sibling or place the child under the source Session; both fork at the last completed Turn, increment the inherited title, and open the child. **Manage Session directories** keeps the primary cwd fixed and replaces the canonical list of additional writable roots for later commands. Archive hides a Session after the Workspace echo; the archived view can restore it or permanently delete its lineage after confirmation. Multi-selection supports toggle and visible-range gestures, keyboard movement, select all, batch archive, batch delete, Workspace membership changes, and optional todo creation. Workspace Delete removes the registration while its Sessions remain under Ungrouped.

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

The package fills the sidebar browser and Session Intent picker slots and contributes the Session-count, multi-selection, and status-presentation rows to General Settings. `apply` uses `slots.inject()` for each declaration lifetime and re-registers after a declaring slot is restored. A persisted viewing store owns grouping, ordering, expansion, row-count, and status-perimeter preferences; a separate non-persisted store owns the current multi-selection.

### The directory-flow hole

Each registration declares a **directory-flow child hole** (`single` kind: `conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow`) that the composed picker package's client half fills with its picking interaction — the `-native` backend's renderless OS-chooser driver, an in-app browsing dialog under a `-browse` composition. The flat **Add workspace...** action renders only while the surface's hole is occupied; an empty hole means the composition has no picking affordance. This package owns the trigger and the adoption: the occupant reports one picked path per open through the hole's owner conversation (`open`/`busy`/`onPicked`/`onCancel`/`onError`), and the owner adopts it through the object layer, selecting the committed Workspace only after its list projection has refreshed.

### View state

Once the Workspace list baseline is ready, browser-persisted expansion and Session-order records retain only current Workspace ids plus Ungrouped and the flat-list account. Real Workspaces initialize from `WorkspaceView.sessionIds`, while Ungrouped and the cross-Workspace flat list initialize from recency. The shared sidebar projection hides rows whose durable Session summary has `origin: 'subagent'`, and each visible ordinary row keeps the blue activity dot while any descendant reached through uninterrupted subagent-origin lineage is running; descendant-only activity never claims the own-running perimeter. The same pure derivation reads the Schedule and `sessionDigest` list projection values for grouped, flat, archived, and search nodes; the package uses only the type-only `@deepseek-ai/dsh-schedule/client` and `@deepseek-ai/dsh-session-digest/types` dependencies and imports neither feature runtime.

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
- **Native folder selection depends on the local Host carrier** — under the `-native` composition, in-process or remote browser deployments cannot open a local operating-system dialog; remote-capable picking is the `-browse` composition's in-app flow.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Controller contracts own Host mutation failures; the browser's viewing and selection stores remain Client-local and every slot registration is effect-owned.
