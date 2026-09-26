---
description: "Review cross-workspace Session results, follow running work, and configure the digest's workspace filters and card layout."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-digest

English | [中文](README.zh.md)

## Summary

Review finished, running, failed, and waiting Sessions across workspaces. Follow the agent's current checklist and recorded updates, then open a Session, file a todo, pin it, or mark it handled. Configure workspace filter rows under Layout without reserving empty space. The digest uses existing summaries rather than loading every transcript; previews do not mark answers as viewed.

## Table of Contents

- [Use this package](#use-this-package)
- [Workspace strip and running work](#workspace-strip-and-running-work)
- [Reading and acknowledgement](#reading-and-acknowledgement)
- [Data](#data)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Cross-workspace inbox surface. A **汇总** entry between New Session and the workspace browser carries the state counts — sessions waiting for the user (warn tone), finished unread (the **已完成** section, success tone), running (blue), and failed (error tone), in the order the **汇总面板** settings page sets, plus an optional grey count of finished sessions already seen; each pill shows only while non-zero, and on the collapsed rail one pill carries their sum in the tone of the first state present — and toggles one panel over the center column with four tabs: **收件箱**, **待办**, **项目待办**, and **时间线**. `Ctrl+1` through `Ctrl+4` open Inbox, Todos, Project todos, and Timeline respectively; pressing the selected tab's chord keeps it open. Desktop tabs display their chords, a contrasting selected fill, and a persistent underline. These navigation chords do not run inside editable fields, menus, or modal dialogs. They take precedence over the configurable panel toggle, whose other chords retain their existing behavior. Close with Escape or the close button. Browsers or operating systems may intercept Ctrl-digit shortcuts before the page receives them.

The inbox answers "what needs me, and why" across every workspace at once. Rows are sectioned by the reason they need attention, in the order a morning of triage wants them: **置顶** (the user's stated priority, listed first; a running pinned row stays under 运行中), **已完成** (a reply landed after the user's last seen mark), **已读未处理** (acknowledged as viewed but not marked handled), **运行中** (in-flight work), **等你回复** (the agent is blocked on an approval or question), **失败 / 中断** (the last turn ended any way but `completed`, or never closed), and, on request, **已处理**. Running, waiting, failed, unread, and pinned rows are listed regardless of the time window; the window (**自上次查看**, **今天**, **近 7 天**, **全部**) bounds only the context rows. Snoozed rows are counted and never listed. Workspace chips above the sections carry each workspace's attention and running counts and narrow the view to one workspace or to ungrouped work.

The toolbar's **分区** / **看板** toggle chooses the desktop arrangement. Sections stack populated states; the board places populated state columns side by side in decision order: **等你决定**, **已完成** (unread and seen together), **运行中**, **失败 / 中断**. Empty states reserve no space. A sole state uses the full content width in either arrangement; its rows stay at the top and grow only to their content height, without stretching a sparse list to fill the viewport. **Settings → Digest panel → Cards per row** selects 1–8 columns, default 5, for each section or single-state board. Available width can reduce that count to keep cards at least 240px wide; a narrower container uses one full-width card. The preference persists in this browser without changing workspace filters; card edges and actions align. Multiple board columns scroll independently. Pinned rows retain their state's column, and handled rows join finished or failed by outcome. **显示结果** controls closing answers and their truncation hints, not running-work details; hiding results clamps the question to two lines. Both preferences persist per browser. Phones retain compact, single-column sections and expose the result toggle under **更多操作** in Small layout.

Each desktop card shows the status badge, the session and workspace, the newest human question, the closing answer, and the files the turn changed — the question and answer scroll inside a bounded card body, while cards share aligned row heights — with the actions the keyboard ring also reaches: **打开会话**, **继续** (opens the session with a continuation line in the composer), **标记已处理**, **加入待办** (moves the row to the todo list: an open todo already addressing the same question is reused rather than duplicated, and the session is marked handled so the card leaves the inbox), **置顶**, and **明天再看** (snoozes until 09:00 the next day). Each row sizes independently to its content; the card body has no separate fixed height cap. Cards cap their height against the content viewport with a 240px lower cap to keep controls usable in short windows. The head and actions remain outside the scrolling body; the surrounding content scrolls when the window cannot fit a card. Action buttons wrap by their actual text and available width, with compact horizontal padding and keycaps rather than a fixed two-button grid. The keyboard legend occupies a compact footer outside that scroller. The ring selects its first visible card whenever the panel opens, then walks the cards in section order, or column by column on the board: `j`/`k` move along it and `Home`/`End` jump to its ends; the arrow keys move along the row (`←`/`→`) or down the column (`↑`/`↓`) on screen — into the next section when a card sits under the focused one, on the board to the card beside it in the next column — and stop at the row's or column's edge; `Tab`/`Shift+Tab` jump to the first card of the next or previous populated group; at either end, or when a control holds focus, native focus traversal reaches the toolbar and workspace filters; `Enter` runs the card action the **汇总面板** settings page names (default **打开会话**), or opens the session when the focused card lacks that action; `Shift+Enter` always opens the session; the digits `1`–`6` press the card's buttons in order, every desktop card always draws each available button's digit beside its label, while the outline identifies the single card the keys operate on; `Escape` closes. The digits are also the sidebar pinned area's default chords, so the panel claims them in the capture phase while it is open on the inbox tab. On open the panel takes focus from wherever the toggle chord was pressed, so keys reach it rather than the covered composer, and it gives the focus back on close; every key stays silent inside editable controls. **标记已查看** moves the "since last review" boundary to now; **复制晨报** puts the current sections and open todos on the clipboard as Markdown. Any explicit Session navigation dismisses the panel, including clicking the already-selected sidebar row; passive selection restoration leaves it unchanged.

The todo tab lists the user's todos joined with the session and question each points at, offers **跳到那一问** (scrolls the session's transcript to the addressed question through ui-conversation's `chatReveal` seat), **继续**, completion, and removal, and adds a todo about the current session from an input. Below them, sessions whose last turn did not finish appear as automatic todos with open, continue, and handled actions. The session browser's right-click menu offers **加入待办** for the selected sessions through the `sessionTodos` seat this package provides. The timeline tab places every retained question of every session on the day it was asked, newest first, and opens the session at that question.

The project todos tab lists the todo documents (`TODO.md` and friends) the Host's [`projectTodos`](../../todo/project-todos/README.md) scan found under the configured roots and every registered workspace: one section per project directory with its sources and open/done counts, one block per document with its items (checkbox state, nesting, and section on hover), folded after eight items. Each document offers **在此项目新建会话** (registers the directory as a workspace when needed, opens a session there, and prefills the composer with a line pointing at the document), **查看原文** (the document text inline, read through the Remote), and **用系统应用打开**; each project offers **打开目录**. **重新扫描** asks the Host to scan now, **只看有未完成项的项目** hides finished projects, and the scan is read the first time the tab shows. The same package contributes three settings pages beside the shipped sections: **汇总面板** (the panel's toggle chord — pressed into a read-only field, saved on the spot, and refused with a reason when the key is unsupported or belongs to editing or the browser under Ctrl/⌘ — the card action `Enter` runs in the inbox, whether the entry shows the state badges, whether the grey finished badge joins them, and the badge order — reordered by dragging rows or with move buttons — over the `ui-digest` settings section the node half registers; a stored chord the recorder would refuse reads as the default), **项目待办** (roots with a directory chooser, file patterns, workspace inclusion) over the `project-todos` settings section, and **置顶** over the `session-pins` section: **启用置顶** (default on; off hides the card action and its `5` key, the inbox 置顶 section, the session browser's menu item, and the sidebar pinned area while the marks stay durable), **侧栏置顶区**, its **显示会话数** (**自适应** or 1–20 rows, default 5), the **自动置顶** statuses the sidebar area lists beside the pin marks (进行中, 已完成, 出错; default running and completed), and **汇总面板置顶分组** (off lets a pinned row fall into its ordinary section). The sidebar area's ⋯ menu edits the same two settings through the `sessionPins` seat, so both surfaces show one value.

On phones, **Overview** retains the four tabs with a separate phone tab selection initially set to Inbox. Running work appears first, and its count toggles a running-only filter. Workspace filters use the same saved row limit, initially a horizontally scrollable single row. **Pending** presents sessions waiting for approval, plan review, or an answer, followed by finished unread sessions and the existing personal todo list. This view ignores the overview's time and Workspace filters and omits failed-session automatic todos. **加入待办** uses the same Host-backed personal todos on both layouts; project todo documents remain a separate Overview tab.

Phone Overview and Pending session rows initially show only the title, unread indicator, and disclosure control. Activating the title reveals the question, reply, files, and actions; at most one session is expanded per panel. Collapsed details and actions are not mounted, and the disclosure exposes its state and target through `aria-expanded` and `aria-controls`.

In the Small phone layout, or on phone viewports at most 500px tall, Overview combines View and Time range into two native select controls beside More. More retains the running filter, handled visibility, review, and copy actions; the larger layouts retain the expanded controls.

<a id="reading-and-acknowledgement"></a>
## Reading and acknowledgement

Automatic mode marks the current Session's latest completed Chat answer as viewed after 5 continuous seconds of exposure. Its rendered answer content must be onscreen and uncovered in a visible, focused document; reasoning alone does not count. Leaving the answer, losing visibility or focus, covering it, or receiving a different reply seq resets the interval. Separate visits never accumulate time. Selecting a Session or historical question alone never marks a reply seen.

In **汇总面板** settings, `readAcknowledgement` selects `automatic` (default) or `manual`, which requires an explicit action. `readGraceSeconds` sets the full continuous interval to a whole number from 1 to 60 seconds (default 5), saved when the numeric field loses focus. The interval control is disabled in manual mode; both controls are disabled when settings cannot be written. Automatic acknowledgement requires ready settings and pauses while they are loading or unavailable; it never uses default values to acknowledge a reply in those states. The explicit header action can still persist acknowledgement when the inbox service is available.

The current Session header offers **标记已查看** for its unread completed answer in either mode, including in Trajectory. The action acknowledges that reply without marking the Session handled or changing its pin. A failed write preserves unread state; the header action remains available to retry. Viewed-but-unhandled results remain eligible under the existing inbox time-window rules. The digest panel's separate **标记已查看** action advances the review window rather than acknowledging a particular reply.

<a id="workspace-strip-and-running-work"></a>
## Workspace strip and running work

**Settings → Layout → Digest workspace strip** offers **Single row** (default), a cap of **2–6 rows**, and **Show all**. A row cap uses only the height actual chips need. Overflow remains scrollable; **Show all** expands it temporarily without changing the saved preference or the active workspace filter, and **Collapse** restores the cap. Single-row mode supports mouse dragging, touch, and native horizontal scrolling. Preferences persist in this browser; malformed row limits read as Single row. Even fully expanded chips scroll within a viewport-relative height cap so they cannot displace the cards.

Running cards show active agent tasks and checklist counts, the latest recorded assistant text, cumulative steps and tool calls/results/errors, and running or stopping background jobs visible to that Session. Text previews and sampled labels are bounded; omitted tasks, tool names, and jobs retain their counts. The task checklist comes from the agent, not the inbox's personal todos. Own-session accounting takes precedence over whole-log statistics; the fallback explicitly includes inherited history. Missing projections omit metrics rather than claiming zero progress, and unmatched tool calls are never treated as a live-tool count. **Latest recorded update** is committed visible text, not reasoning, a token stream, or a guaranteed current-turn statement; automatic continuation can retain the preceding update until a new one settles.

<a id="data"></a>
## Data

Every card's content already rides the session list: each row carries the host's [`sessionDigest`](../../session/session-digest/README.md) projection value, so opening the panel issues no session request and shows sessions this browser never attached to. Running-work details join the existing `todos`, `usageLedger`, and `sessionStats` projection values with `jobsBySession` from the Host-wide control stream; the panel opens no per-card history subscriptions. The user's marks — seen seq, handled, snooze, pin, review time, and todos — come from the host's [`sessionInbox`](../../session/session-inbox/README.md) Remote through one controller: read once on load, replaced by every mutation reply and by the forwarded `session-inbox/changed` push, and re-read after a connection reset. The plugin records a reply's seen seq only after the continuous exposure interval or an explicit acknowledgement, so unread state survives refresh without treating navigation as reading. The attention count is also reported into ui-renderer's `documentBadge` seat, which prefixes it to the browser tab title.

Archived sessions, blank sessions, and subagent-origin rows never appear. Question and answer text are cut to the host's configured budgets; a card whose answer was cut says so and points at the session.

<a id="composition"></a>
## Composition

```yaml
- id: ui-digest
  name: '@deepseek-ai/dsh-client-ui-digest'
```

The sidebar entry and panel register into two seats declared by other packages — `sidebar.nav.entry` ([ui-sidebar](../ui-sidebar/README.md)) and `center.overlay` ([ui-layout](../ui-layout/README.md)) — through `slots.inject()`. Both registrations share one viewing store (open, tab, window, workspace filter, handled visibility), one inbox controller, and one project todos controller created in `apply`. Injects `remote.sessionInbox` and `remote.projectTodos`; without the host `sessionDigest` unit the panel composes normally and reports nothing to handle. It provides the `sessionTodos` and `sessionPins` seats consumed by ui-workspace — the latter publishes the pinned Session ids, the finished unhandled Session ids (the inbox's 已完成 and 已读未处理 rows under the since-review window, so the sidebar's completed auto-pin survives a Host restart), and the 置顶 policy (area height and auto-pin statuses included) as one snapshot, republished only when one changed, pins or unpins through the inbox controller, and writes the height and statuses to the `session-pins` settings — reads the optional `chatReveal`, `chatReplyExposure`, `conversation`, and `documentBadge` seats, and registers the three settings pages into `settings.section` ([ui-settings](../ui-settings/README.md)) once `settingsScope` exists; the node half registers the `ui-digest` and `session-pins` settings namespaces when a settings provider is present. A separate registration contributes the current Session's manual acknowledgement to `conversation.session.header.actions`.

<a id="model-experience"></a>
## Model Experience

None, as the inbox is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **One card per session** — the card shows the newest question and its answer; earlier questions appear on the timeline without their answers.
- **No full reply beyond the configured preview** — a host-truncated answer sends the user to the session rather than fetching every listed history.
- **Exposure is not comprehension** — automatic acknowledgement observes only rendered Chat answers, not digest card previews or Trajectory. The header's explicit action remains available; neither an exposure interval nor a viewed mark proves understanding or means handled.
- **Snooze time is fixed** — the only snooze is until 09:00 local time the next day.
- **The panel covers the center column while open** — it is a surface switch, not a split view.
- **Project todo documents are read-only here** — checking an item off means editing the file; the Host watcher then refreshes the tab.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

The [layout and running-work decision](../../../.agents/notes/implemented/feature/2026-09-26-digest-workspace-layout-and-running-work.md) records data limits, keyboard access, and verification ownership.

</details>
