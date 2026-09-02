# Agent Note: Durable session inbox

Status: implemented

English | [中文](2026-09-17-durable-session-inbox.zh.md)

## Problem

A user who runs many agent conversations across several Workspaces and leaves for the night comes back with no durable record of what happened: the sidebar's green "finished" dot is a browser-memory bit that clears on selection and on refresh, the [digest panel](2026-09-01-cross-workspace-finished-session-digest.md) lists every finished session forever with no notion of which ones the user has dealt with, a session blocked on an approval or question waits unnoticed, and there is no place to write down "follow up on this tomorrow" that points back at the conversation. The state model was one transient bit where the user needs several durable ones.

## Decision

### The user's decisions live on the Host

`@deepseek-ai/dsh-session-inbox` is a storage-domain sidecar behind the `sessionInbox` Remote. Per Session it stores `lastSeenSeq` (the highest log seq the user had on screen; `markSeen` only raises it), `handledAt`, `snoozedUntil`, and `pinned`; globally it stores `reviewedAt`; and it stores todos addressed to a Session and optionally to one `user/message` seq. Every read and mutation answers with the complete snapshot and every write emits `session-inbox/changed`, forwarded to browsers through the `dsh-api-remotes` allowlist. The Session log stays the record of what the agent did; the sidecar is the record of what the user decided about it, so it survives refresh, another browser, and a Host restart, and two browsers converge on one snapshot without merging.

"Unread" is derived, not stored: a row is unread when the digest's newest landed seq (`replySeq`, or `questionSeq` while unanswered) exceeds `lastSeenSeq`. The client marks the current session seen whenever that seq is on screen, so opening a session clears its unread state exactly as the green dot did — but the mark is durable and the row does not vanish, it moves to "seen, not handled" until the user marks it handled.

### The digest projection carries what the inbox needs

`sessionDigest` (state version 2) adds `questionSeq`, `questionAt`, `repliedAt`, the changed-file record (`changedFiles` bounded, `changedFileCount` complete) read from the mutation tools' own `tool/result` `diffs[].path` record, and a bounded `history` of earlier questions with their outcome, reply time, and file count. That is enough for a per-question timeline, a todo that points at one question, and a "changed N files" line on a card, all still riding the session list with zero I/O per open.

### One surface, sectioned by why

The digest panel becomes the inbox: rows are sectioned by the reason they need attention — pinned, waiting for the user, failed or interrupted, finished unread, seen but not handled, running, and (on request) handled — in that order, because the agent blocked on an approval is the one costing a night. Waiting, failed, unread, and pinned rows are admitted regardless of the time window; the window (since last review, today, last 7 days, all) bounds only the context rows. Snoozed rows are counted, never listed. Workspace chips carry per-workspace attention and running counts. Each card offers open, continue (open with a composer prefill), handled, add todo, pin, and snooze; a keyboard ring (`j`/`k`, `Enter`, `e`, `t`, `p`, `s`, `Escape`) reaches the same actions. The sidebar entry owns one chord, `Ctrl+1`, that toggles the panel from anywhere: it is the mounted-for-the-session control, and the modifier keeps the chord live inside the composer where the single-letter ring must stay silent. "Mark reviewed" moves the default window's boundary; "copy brief" renders the sections and open todos as Markdown. The todo tab lists todos joined with their session and question and the failed sessions as automatic todos; the timeline tab places every retained question on the day it was asked.

Three small seats connect the panel to its neighbours: ui-conversation's `chatReveal` (a reveal request rides the per-session chat store, and the chat pages back until the row is loaded), ui-workspace's `sessionTodos` (the right-click menu's "add to todos" hands the selected ids to whoever provides the seat), and ui-renderer's `documentBadge` (the attention count prefixed to the tab title). Each is optional on both sides.

## Alternatives considered

**Persist the seen mark in the browser.** Rejected: the mark would differ per browser and per profile, and the failure being fixed is precisely a state that did not survive the user leaving.

**Store "unread" as a flag the Host flips on `turn/end`.** Rejected: the Host would need to know which client is looking; deriving unread from `lastSeenSeq` against the digest's landed seq needs no such knowledge and stays correct when a later reply lands.

**Create automatic todos on the Host for failed turns.** Rejected: the failed set is already derivable from the digest outcome and the handled mark, so storing it would be a second authority that could disagree with the log.

**A separate button beside the digest entry.** Rejected: two whole-surface entries answering "what happened while I was away" is the duplication the [question rail note](2026-09-02-question-rail-reduced-to-stepping.md) removed elsewhere; the digest entry grows into the inbox instead.

**Scroll-based reveal through a global service that scans the transcript.** Rejected: the chat view already owns the question index and the paging; the request only needs an address (`seq`) and a durable place to wait, which the per-session store provides.

## Consequences

Finished work no longer disappears from the record when it is viewed; it moves through unread → seen → handled under the user's control, and a session waiting on the user is the first thing the inbox shows. Every mark and todo is visible from any browser attached to the same Host.

`sessionDigest` bumps its state version, so persisted projection cache rows are recomputed on next fold. The list payload grows by the bounded history and file list per row (`historyQuestions`, `changedFilePaths` budgets). Marks on deleted Sessions stay in the sidecar until their todos are removed; nothing joins them, so they are invisible.

The seen mark follows selection, not reading position; the snooze time is fixed at 09:00 the next day; and the panel remains a surface switch over the center column.

## Verification

The Host suite pins monotonic `markSeen`, handled/snooze/pin idempotence, `snooze-in-past`, todo text validation and lifecycle, sort stability, restart recovery, and disposal admission. The digest suite pins the file record narrowing and bounds, the history bound, and the new field budgets. Client suites pin classification and sectioning, the window and workspace filters, the chip counts, the timeline grouping, the todo join, the brief text, the controller's read/push/resync/failure paths, the seen-mark subscription, the badge seat, the `sessionTodos` seat, the `chatReveal` handoff through the chat store, the keyboard ring, and every card and tab action. `pnpm run test:gui` passes apart from the pre-existing `directory-picker-native` Win32 probe.

## Related

- [Cross-workspace finished-session digest](2026-09-01-cross-workspace-finished-session-digest.md) owns the digest projection's delivery path and the panel's two seats; this note replaces its "reuse the transient completed bit" reasoning with the durable seen mark.
- [Session projection state and client views](../architecture/2026-08-19-session-projection-state-and-client-views.md) owns the fold-state/client-value split `sessionDigest` extends.
