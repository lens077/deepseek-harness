# Agent Note: Pinned area fold, ⋯ menu, and auto-pin statuses

Status: implemented

English | [中文](2026-09-21-pinned-area-fold-menu-and-auto-pin.zh.md)

## Problem

The sidebar **置顶** area from [Pinned sessions in the sidebar and the digest](2026-09-11-pinned-sessions-in-sidebar-and-digest.md) always takes its fixed height, holds only Sessions the user pinned by hand, and can be resized only from the settings page. A user watching several Sessions at once wants the ones that are running, or just finished, or just failed to surface in that area without pinning each by hand, wants the area's size at hand where the area is, and wants to fold the area away when the Workspace tree needs the room.

## Decision

The area gains a fold, an options menu in its header, and automatic membership by Session status; the settings page shows the same values.

### Two more durable fields, one seat

The `session-pins` namespace grows two fields. `sidebarRows` accepts `'auto'` beside its 1–20 integer: the list then takes one row of height per listed Session (capped at 20 rows, the largest fixed count, so the Workspace section keeps room) instead of a fixed slot count. `autoPinStatuses` is a list over `'running' | 'completed' | 'failed'` (default running and completed): every visible Session in one of those statuses is listed in the area beside the pin marks, once, in the same recency order, and `derivePinned` applies the tree's visibility rule to both sources. `completed` means finished and not yet opened, read from two sources: the Session summary's transient "finished while not selected and not yet reopened" bit, and the `completedSessionIds` the provider publishes from the inbox's durable marks (`selectFinishedUnhandled`: the 已完成 and 已读未处理 rows `selectInbox` yields under the since-review window — outcome completed, not handled, not snoozed, not waiting on the user; unread rows regardless of the window, seen rows only since the last 标记已查看 or the last day). The summary bit alone dies with the Host process, which emptied the area after every restart while the digest still listed the same Sessions; the durable ids keep the two surfaces on one definition, 标记已处理 removes one row, and 标记已查看 clears the seen ones. `failed` is the digest's `outcome === 'error'`. The `sessionPins` seat carries both fields in its view and gains `setSidebarRows` and `setAutoPinStatuses` writers that `ui-digest` routes to its `PinsSettingsPolicy`, so the sidebar menu and the settings page write one document and read one view.

### A listed row reads as pinned, and unpin dismisses an auto-listed one

A Session the area lists by status has no pin mark, yet its row menu saying **置顶** while it sits in the pinned area reads as wrong. The browser therefore treats "listed in the area" as the pinned state for every row menu and the multi-selection verb: **取消置顶** clears the mark on a marked Session and dismisses a status-listed one. A dismissal is browser-local viewing state (`pinnedAutoDismissed` in the workspace viewing store, Session id → `autoPinStatusKey`, the matched statuses at removal) and holds only while that key stands: a running Session dismissed returns when it completes, a completed one returns when it runs again, and **置顶** lifts the dismissal before writing the mark. `derivePinned` skips a dismissed candidate only when the recorded key equals the current one, so a stale entry never hides a Session.

### The header owns the fold and the menu

The area header is a fold button (chevron, the **置顶** label, and the hidden row count while folded) plus a ⋯ button. The fold lives in the persisted workspace viewing store (`pinnedCollapsed`, persist key bumped to `v11`, then to `v12` by the [position shortcuts](2026-09-22-pinned-area-position-shortcuts.md) that share the same store), like Workspace group expansion. The ⋯ menu lists **显示会话数** (**自适应**, 5–20) and **自动置顶** (**进行中**, **已完成**, **出错**) through the `Menu` primitive's independent-group selection; a count pick closes the list, a status toggle keeps it open and sends the complete selection. Provider refusals are logged, not thrown into React, as pin refusals already are.

### The settings page shows the same two controls

**置顶区显示会话数** becomes a select over **自适应** and 1–20, and an **自动置顶** checkbox group follows it; both follow the sidebar-area switch. Their hints name the sidebar menu as the other writer of the same value.

## Alternatives considered

**Make `autoPinStatuses` apply only in `auto` mode.** Rejected: the status filter and the height answer different questions, and a fixed-height area that scrolls through auto-listed rows is still useful; coupling them would leave the status checkboxes dead under a fixed count.

**Keep the fold as component state.** Rejected: the sidebar remounts on layout changes and reloads, and Workspace group expansion already persists in the same store.

**Read `completed` from the summary bit only.** Rejected after use: a Host restart drops every reminder bit, so the area opened empty while the digest still showed finished Sessions; `running` is legitimately empty after a restart, but a finished reply the user has not handled is a durable fact the inbox already stores.

**Durable `completed` as the unread rows only.** Rejected after use: opening a Session marks it seen, so after a restart the area listed only Sessions started since, while the digest's 已读未处理 section still held the finished work the user had glanced at but not closed out. The handled mark, not the seen mark, is the user's "done with this"; the since-review window bounds the seen rows exactly as the digest does.

**Order running rows first.** Rejected for now: the area's contract is recency order, the running perimeter already marks them, and a second order would need its own setting.

**Store dismissals as a durable inbox mark.** Rejected: a dismissal is "not now" for one browser's sidebar, not a decision about the Session; the pin mark stays the only durable per-Session fact, and a dismissal that lapses with the status needs no cross-device agreement.

**A third `count` mode that hides the area when empty.** Rejected: the fold gives the user that control explicitly, and an area that appears and disappears with status changes would move the Workspace header under the pointer.

## Consequences

With the defaults, every running Session and every unopened finished Session now appears in the pinned area for users who kept the feature on, so the area is populated on first sight instead of showing the empty hint. Users who want the old behavior clear the auto-pin statuses in either surface. `dsh.workspace.view.v9` persisted viewing state is abandoned for the `v11` key (and the `v12` key of the position shortcuts); grouping, ordering, and expansion preferences reset once. A `session-pins` settings document written by the previous schema decodes unchanged: the new fields take their defaults.

## Verification

`ui-workspace` specs pin `derivePinned`'s union, deduplication, dismissal keys, and visibility over each status, the fold's persistence and count, the auto-listed row's unpin verb, dismissal lifecycle, and pin lifting it, the menu's selection marks, count writes, status toggles, Escape, and refusal logging, the `auto` sizing, and the seat mirror's new writers. `ui-digest` specs pin the schema (`auto`, range, unknown status rejection) on the node half, the policy's adoption and writers, the settings page's select and checkbox writes and disabled states, and the seat's republish-on-change over the new fields.

## Related

- [Pinned sessions in the sidebar and the digest](2026-09-11-pinned-sessions-in-sidebar-and-digest.md) owns the seat and the settings page this note extends.
- [Pinned area position shortcuts](2026-09-22-pinned-area-position-shortcuts.md) adds the **快捷键** group to the ⋯ menu and the per-position chords to the same viewing store.
