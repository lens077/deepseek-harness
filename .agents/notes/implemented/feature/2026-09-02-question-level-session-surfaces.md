# Agent Note: Question-level session surfaces

Status: implemented

English | [中文](2026-09-02-question-level-session-surfaces.zh.md)

> Superseded in part: compact mode was removed by [the question rail reduced to stepping](2026-09-02-question-rail-reduced-to-stepping.md), which deleted every surface that redrew the question index. The join, the question bar, the turn recap, the tab-title mark, and both seams remain current.

## Problem

A reader who runs many long tasks in one session cannot tell what an answer answers. When a turn ends they are at the transcript floor, and the message that started it is thousands of pixels above; the file rail lists what the *session* changed with no way to see what *this* question changed; and the browser tab says nothing about work left running.

[Question navigation](../architecture/2026-08-28-question-navigation.md) solved the adjacent problem — reaching another question — and its cost is the same one: jumping to the question abandons the answer, so the reader pays a second jump to return. Navigation moves the reader; nothing kept the question present.

## Decision

One derivation, four surfaces. `chat/turn-summary.ts` joins the loaded questions to the turns that answered them, and every surface that names a question reads that one index.

### The join

A question belongs to the last turn that opened at or before it. That is the order the log records: `turn/start` opens the turn and the loop *then* writes the `user/message` events entering its first step. One batch of queued messages therefore shares a turn, and the first of them is that turn's displayed opener.

This is the seq-to-turn rule [ui-session-files](../../../../packages/client/ui-session-files) already attributes changes with, so a question and the files its turn changed cannot disagree about ownership. The earlier draft joined each question to the first turn starting *after* it — the intuitive order, and backwards; a snapshot log settled it.

`buildTurnGroups` attributes Nodes by anchor seq against the same boundaries and emits one group per turn rather than per contiguous run: a turn is the unit a reader folds and has to stay one row however its Nodes are ordered.

### The four surfaces

**A sticky question bar** at the top of the transcript scrollport, naming the question whose answer the reader is inside, with the turn's outcome, live clock, and changed-file count. It appears only once that question's row has fully passed the scrollport's top edge, and it renders in a **zero-height sticky dock**: the chat view's follow, prepend-anchoring, and paging logic all measure `scrollHeight`, so a bar that entered and left the flow would move the reader's position every time it changed.

**A turn recap** at the end of a completed turn spanning at least `RECAP_MIN_ROWS` rows. Rows are the proxy for scroll distance available without measuring layout. A short exchange gets none: its question is still on screen, and a line restating it would be noise on every turn of a linear read.

**A compact mode** folding each settled turn to one row — question, outcome, clock, file count — with the newest turn, any running turn, and any turn the reader unfolded left whole. Folding what just arrived would hide the answer the reader is waiting for. This surface no longer ships: [the question rail reduced to stepping](2026-09-02-question-rail-reduced-to-stepping.md) removed it as one of three surfaces drawing the same index, leaving the transcript with no mode in which turns are rows.

**A tab-title mark**: `●` while any session runs, `✓` latched when the last run finishes while the tab is hidden, cleared by the visit that delivers it. Latched rather than momentary, because that completion is exactly the event a reader who switched tabs missed.

### The two seams

The surfaces span two plugins, so each direction is an optional service reached through `ctx.get`, matching the existing `chatFileDiffs` arrangement.

`ChatFileDiffs.forTurn` slices the recorded changes by owning turn; ui-conversation asks it for a turn's files. It is local-only: a descendant session's turn numbers are its own, so merging them would attribute a subagent's turn 3 to the parent's.

`chatQuestionIndex` publishes the question index; ui-session-files asks it which turn belongs to which question and groups the file rail under the questions that caused the changes, newest first, with everything unattributable collected in one trailing group. Without the service the rail keeps its flat list, and a `按提问`/`全部` toggle keeps that list one click away.

Both are resolved per call so composing either provider in or out takes effect live, and both are memoized against the snapshot, which is immutable and replaced on change.

## Verification

Run the ui-conversation, ui-session-files, and ui-renderer suites, the client typecheck through `tsc -b tsconfig.client.json`, and `pnpm run test:gui`.

## Alternatives considered

**Publish the opening question as turn-scope Location data and let a `conversation.chat.turnTail` entry draw the recap** — rejected because a turn's opener is not reachable from its own Context: `turn/start` opens the Context before the `user/message` exists, and `reader.previous('input-message')` returns the nearest message of any kind, which an injected context message wins. Deriving the recap in the chat view's existing memo keeps one index and costs no per-node scan, which the [Conversation Node rules](../../../../packages/client/AGENTS.md) forbid anyway.

**Put the current question in the session header** — rejected because the header is session chrome shared across view tabs, while the current question is a scroll-position fact. A header naming it would be wrong the moment the reader scrolled, and wrong for every non-transcript view.

**Make the file rail a permanent question outline** — rejected as the primary fix. The navigator's expanded panel is already a searchable question list; a resident copy spends 240px to save one click and still answers "take me somewhere", not "what am I reading".

**Duplicate the question derivation inside ui-session-files** — rejected because the rail already reads the conversation snapshot and could have walked it again. Two derivations of "what is a question" would drift, so the index crosses as a service instead.

**Write a second `document.title` from the conversation plugin** — rejected because `DocumentTitle` in ui-renderer owns that fact; the run mark is a prop on the existing owner.

## Consequences

No session events and no model-visible change: every fact is derived from the Chat projection and the existing timeline, so replay and paging keep one authority.

The chat view's per-scroll question scan became one pass over the rendered anchors; the per-question form was quadratic in a long session and now also reports whether the current question has left the viewport.

Two test fixtures were corrected rather than worked around. `chat-snapshot-fixture` synthesized `turn/end` with a flat `reason: 'completed'` instead of the envelope's `data.reason.kind`, and placed `turn/start` *after* the turn's own nodes. Both diverged from the log, and readers of either fact would have inherited the divergence.

Compact mode and the rail's grouping were per-mount reader state, deliberately not persisted: they are ways of reading one session right now, not preferences about every session. That rule still governs the rail's grouping; compact mode itself has since been removed.
