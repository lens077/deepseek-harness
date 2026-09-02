# @deepseek-ai/dsh-client-ui-digest

English | [中文](README.zh.md)

Cross-workspace inbox surface. A **汇总** entry between New Session and the workspace browser carries the attention count — how many sessions are waiting for the user, failed, or finished unread — and toggles one panel over the center column with three tabs: **收件箱**, **待办**, and **时间线**. `Ctrl+1` toggles the same panel from anywhere: the entry is mounted for the whole session, so it owns the chord, and because the chord carries a modifier it stays live inside the composer and the panel's own inputs.

The inbox answers "what needs me, and why" across every workspace at once. Rows are sectioned by the reason they need attention, in the order a morning of triage wants them: **置顶**, **等你回复** (the agent is blocked on an approval or question), **失败 / 中断** (the last turn ended any way but `completed`, or never closed), **完成未读** (a reply landed after the user's last seen mark), **已读未处理** (opened but not marked handled), **运行中**, and, on request, **已处理**. Waiting, failed, unread, and pinned rows are listed regardless of the time window; the window (**自上次查看**, **今天**, **近 7 天**, **全部**) bounds only the context rows. Snoozed rows are counted and never listed. Workspace chips above the sections carry each workspace's attention and running counts and narrow the view to one workspace or to ungrouped work.

Each card shows the status badge, the session and workspace, the newest human question, the closing answer, and the files the turn changed, with the actions the keyboard ring also reaches: **打开会话**, **继续** (opens the session with a continuation line in the composer), **标记已处理**, **加入待办**, **置顶**, and **明天再看** (snoozes until 09:00 the next day). The ring walks the cards in section order — `j`/`k` move, `Enter` opens, `e` handles, `t` adds a todo, `p` pins, `s` snoozes, `Escape` closes — and, being single letters, ignores keys typed into editable controls. **标记已查看** moves the "since last review" boundary to now; **复制晨报** puts the current sections and open todos on the clipboard as Markdown.

The todo tab lists the user's todos joined with the session and question each points at, offers **跳到那一问** (scrolls the session's transcript to the addressed question through ui-conversation's `chatReveal` seat), **继续**, completion, and removal, and adds a todo about the current session from an input. Below them, sessions whose last turn did not finish appear as automatic todos with open, continue, and handled actions. The session browser's right-click menu offers **加入待办** for the selected sessions through the `sessionTodos` seat this package provides. The timeline tab places every retained question of every session on the day it was asked, newest first, and opens the session at that question.

## Data

Every card's content already rides the session list: each row carries the host's [`sessionDigest`](../../session/session-digest/README.md) projection value, so opening the panel issues no session request and shows sessions this browser never attached to. The user's marks — seen seq, handled, snooze, pin, review time, and todos — come from the host's [`sessionInbox`](../../session/session-inbox/README.md) Remote through one controller: read once on load, replaced by every mutation reply and by the forwarded `session-inbox/changed` push, and re-read after a connection reset. The plugin owns the seen mark: whenever the current session's newest landed seq (its reply, or its question while unanswered) is on screen, the seq is recorded on the host, so "finished while I was away" is durable rather than a dot that vanishes on refresh. The attention count is also reported into ui-renderer's `documentBadge` seat, which prefixes it to the browser tab title.

Archived sessions, blank sessions, and subagent-origin rows never appear. Question and answer text are cut to the host's configured budgets; a card whose answer was cut says so and points at the session.

## Composition

```yaml
- id: ui-digest
  name: '@deepseek-ai/dsh-client-ui-digest'
```

Registers into two seats declared by other packages — `sidebar.nav.entry` ([ui-sidebar](../ui-sidebar/README.md)) and `center.overlay` ([ui-layout](../ui-layout/README.md)) — through `slots.inject()`. Both registrations share one viewing store (open, tab, window, workspace filter, handled visibility) and one inbox controller created in `apply`. Injects `remote.sessionInbox`; without the host `sessionDigest` unit the panel composes normally and reports nothing to handle. It provides the `sessionTodos` seat consumed by ui-workspace and reads the optional `chatReveal`, `conversation`, and `documentBadge` seats.

## Model Experience

None, as the inbox is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One card per session** — the card shows the newest question and its answer; earlier questions appear on the timeline without their answers.
- **No full reply beyond the configured preview** — a host-truncated answer sends the user to the session rather than fetching every listed history.
- **The seen mark follows selection, not reading** — opening a session marks its newest reply seen whether or not the user scrolled to it.
- **Snooze time is fixed** — the only snooze is until 09:00 local time the next day.
- **The panel covers the center column while open** — it is a surface switch, not a split view.
