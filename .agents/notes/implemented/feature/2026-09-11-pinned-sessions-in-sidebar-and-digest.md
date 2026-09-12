# Agent Note: Pinned sessions in the sidebar and the digest

Status: implemented

English | [中文](2026-09-11-pinned-sessions-in-sidebar-and-digest.zh.md)

## Problem

A user running many Sessions at once has no way to say "these few come first". The [durable session inbox](2026-09-17-durable-session-inbox.md) already stores a `pinned` mark per Session, but the only place to set or see it was a card action inside the digest panel, and the pinned rows sat fourth among the inbox sections. The session browser — where the user actually picks a Session — offered no pin verb and no pinned list, so a priority Session still had to be found by scrolling through its Workspace.

## Decision

Pinning becomes a first-class session-browser verb with one durable source and one settings page.

### One mark, one provider, one consumer seat

The pin mark stays in `@deepseek-ai/dsh-session-inbox`; nothing new is stored per Session. `ui-digest`, which already owns the inbox controller, provides the optional `sessionPins` seat that `ui-workspace` declares in its contract: a `view` observable carrying `{ enabled, sidebarArea, sidebarRows, pinnedSessionIds }` and a `setPinned(sessionIds, pinned)` writer. `ui-workspace` mirrors the view into its browser's `hooks` compartment under `ctx.inject(['sessionPins'], …)`, so a composition without `ui-digest` renders no pin affordance at all, exactly as the `sessionTodos` seat hides "add to todos". The view publishes a new snapshot only when the id list or the policy actually changed, so rows do not re-render on unrelated inbox pushes.

### The session browser pins and lists

The session row's ⋯ menu offers **置顶** / **取消置顶** above **重命名**, and the multi-selection context menu offers the same verb for every selected row. Above the **工作区** header the browser renders a **置顶** area sized to a fixed number of session rows (five by default) that scrolls when more are pinned; its rows are the ordinary `SessionNodeItem`, so status dots, hover cards, the row menu, and the selection-aware context menu behave exactly as in the tree. Pinned rows are ordered by Session recency; archived, blank, unknown, and subagent-origin ids are dropped by a pure `derivePinned` next to `deriveFlat`. An empty area shows one hint line instead of collapsing, so the region the user asked for keeps its place.

### The digest lists pinned rows first

In the inbox, the **置顶** section moves to the front: a pinned Session is the user's stated priority and outranks the newest unread reply. Pinned rows are still admitted regardless of the time window.

### One settings page, three switches and a size

A **置顶** settings page (`settings.section` id `session-pins`, right after **项目待办**) owns the durable `session-pins` namespace: `enabled` (default on), `sidebarArea` (default on), `sidebarRows` (default 5, 1–20), and `digestSection` (default on). The master switch hides every pin affordance — the menu items, the sidebar area, the card action and its `p` key, and the digest section; the two finer switches remove one surface each while the mark itself stays durable, so re-enabling restores the same pinned set.

## Alternatives considered

**Render the pinned area from `ui-digest` into a new sidebar hole.** Rejected: the rows would be a second, poorer session row (no status perimeter, no drag-free row menu, no selection) and `ui-sidebar` would grow a hole only one plugin fills. The browser already owns every row presentation; the seat only has to carry ids and policy.

**Project the pin mark into the session list (`projectionValues`).** Rejected: the mark is a user decision stored in the inbox sidecar, not a fold of the Session log; projecting it would create a second authority and a Host change for a browser-side need.

**A global `usePinnedSessions` standard hook via `provideRoot`.** Rejected: a standard hook is required on every component's props, so a composition without `ui-digest` would fail typing or need a stub; the optional seat degrades by absence.

**Store the settings in the existing `ui-digest` namespace.** Rejected: the page is a separate settings entry with its own defaults, and the sidebar switch and row count concern the session browser, not the digest badges; a dedicated namespace keeps one page per namespace.

**Keep the digest section in fourth place.** Rejected: the request is priority handling; a pinned row hidden under running work defeats it.

## Consequences

Pinning is reachable from the row the user is looking at, and the pinned set is the same in the sidebar area, the digest section, and every browser attached to the Host. Compositions without `ui-digest` are unchanged. The sidebar area costs a fixed height (rows × row height) whenever it is enabled, including while empty; users who prefer the space back turn the area or the whole feature off on the settings page. The digest's section order changes for everyone, and stored `ui-digest` settings are untouched. A Host that has not restarted since the upgrade has no `session-pins` namespace, so the page reports settings unavailable and the defaults (everything on, five rows) apply until it does.

## Verification

`ui-workspace` specs pin the menu item placement and labels, the pinned area's ordering, sizing, empty state, and gating, the context-menu verb, and the seat mirror's follow-and-reset lifecycle. `ui-digest` specs pin the `session-pins` schema and defaults on the node half, the settings page's writes and disabled states, the `sessionPins` provider's stable snapshots and failure surfacing, and the inbox's pinned-first sectioning with the `pinnedSection` gate.

## Related

- [Durable session inbox](2026-09-17-durable-session-inbox.md) owns the `pinned` mark and the `sessionTodos` seat precedent this note extends.
- [Configurable digest panel toggle shortcut](2026-09-20-configurable-digest-toggle-shortcut.md) owns the settings-page pattern (`NavSettingsPolicy`) the pins page copies.
