# @deepseek-ai/dsh-client-ui-session-files

English | [中文](README.zh.md)

Session file rail: what this session read and changed. The Node half registers one durable section — the inline-diff expansion preference — and nothing else, because every fact the rail shows is already in the session log. The browser half takes two seats declared by [`dsh-client-ui-conversation`](../ui-conversation/README.md): `conversation.session.tabs.leading` for the control at the head of the view-tab row, and `conversation.session.rail` for the resident pane beside the active view. The shipped Web patch is the only composition that loads this package; removing its one cordis.yml entry removes both surfaces and returns the tab row and view area to their unoccupied shapes.

`deriveSessionFiles` folds one conversation snapshot into the model both seats read, and `sessionFilesOf` memoizes it against the snapshot so a session running to hundreds of steps is walked once per snapshot rather than once per selector call. The vocabulary is the tools' own render intents, the same source [`dsh-client-ui-deliverables`](../ui-deliverables/README.md) reads: a `card: 'diff'` view, or a `card: 'generic'` view whose `kind` is `edit`, is a change; a `card: 'generic'` view whose `kind` is `read` is a read. A search is neither — it returns a hit list, not files the agent opened. Failed calls and deletes contribute nothing, and a call still in flight contributes its path with the writing flag set.

Changed files are listed oldest first, keyed by the seq of their first recorded change, so a file keeps its place when it is edited again and the newest file to be touched sits at the bottom. Each entry carries this session's accumulated hunks for that file in the order they happened, each segment labelled with its turn and tool. That ordering is what the recorded data supports: whole-file before/after never leaves the Host process (`ToolResult` carries only `content`, `isError`, and `meta`), and `computeHunkDiffs` drops `structuredPatch`'s line numbers, so hunks carry no anchor by which they could be ordered by file position or merged where they overlap.

The read list answers what the agent is doing now, so it holds the twenty most recent reads while the agent runs and is empty while it is idle — a derivation of `running`, not a timer or a stored list. Selecting a file calls `revealFile`, which scrolls to the last tool row carrying that path as `data-file`; a file changed outside the loaded window has no row and no match. When the snapshot reports `hasMore` the rail says the list is partial and offers `Load all`, which pages the remaining history one request at a time.

A subagent works in its own session and the parent log records only the delegation call and its result, so a delegated turn contributes nothing to the local derivation. `SessionTreeController` closes that gap by reading descendants directly: `subagent.list` walks the durable child catalog and `subagent.history` reads each child's transcript — live or cold — as `{ event, view }` pairs carrying the same render intents the local snapshot holds, so `deriveTreeFiles` needs no second definition of what counts as a change, only a different walk. Two depths behind one switch: opening the panel reads the finished first-level children, one page each, because a tree can be wide and a panel that opens should not fan out; `Load all` recurses the whole tree, pages every descendant, and completes the local history in the same gesture.

`mergeTreeChanges` folds those into the local model as one row per file whatever recorded it — a file is the unit a reader reviews, so a file two agents touched stays one row and the author rides each segment's label instead (`reviewer · Turn 3 · edit`). Within a row the segments sort by wall-clock time, the only ordering that survives leaving its own session; the rows keep the local order and append descendant-only files after it, because mixing row order across sessions would reshuffle the list every time a descendant read lands.

`SessionFilesRailController` owns the rail's open state and width in one `localStorage` entry for the browser rather than per session: the reader who closes the rail wants it closed everywhere, and the width they dragged is a property of their window. Width clamps to 240–560px and starts at 300px; the rail opens on first use and thereafter honors the persisted choice.

Diffs deliberately do not render in the rail. At its width two code columns are unreadable, and a second, narrower rendering of the same content is a second thing to keep in step — the reading surface is the transcript, which has the full column width and [`SideBySideDiff`](../ui-primitives/README.md).

The same derivation reaches that surface as the optional `chatFileDiffs` service this package provides: given a session and a path it returns the recorded hunks, each labelled with the turn and tool that made it (`Turn 3 · Edit`), and [`dsh-client-ui-deliverables`](../ui-deliverables/README.md) draws them under the chip a reader expands. The service is reached through `ctx.get`, so composing this package out leaves those chips on the opener they had before it existed.

How much of a turn opens without being asked rides the same service as a reactive preference, so a change reaches transcripts already on screen. `DiffExpansionPolicy` owns it: **Expand every file** by default — a written file's diff is what the reader came for — with **Expand only a single file** and **Keep every file closed** as the alternatives, chosen from the *File change comparison* row this package contributes to General settings. The value is durable through `settingsScope` when a settings provider exists and process-local otherwise, the arrangement the composer's busy-Enter preference uses. Reads are absent from the vocabulary by construction: a file that was only read has no comparison to open.

## Model Experience

None, as this package renders client-derived state for a human and touches no prompt, message, schema, stream, or tool result. The guidance that makes the model name its changed files stays with [`dsh-client-ui-deliverables`](../ui-deliverables/README.md).

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **A descendant-only file has no diff in the transcript.** The rail lists it and the merged model holds its segments, but the inline surface hangs off a turn's produced-file chips, and a file only a subagent touched never appears in one. Expanding it under the parent's delegation row is the remaining half of the second stage in the [file panel Agent Note](../../../.agents/notes/proposed/feature/2026-08-26-web-session-file-panel.md); until then, selecting such a row in the rail is inert.
- **A running descendant's changes appear when it finishes, not while it works.** The rail re-reads the tree whenever the catalog mirror's running-child count drops, so a finished child lands without a reload; its intermediate steps do not. Descendants are read rather than streamed because `events.mux` is one aggregated stream the runtime owns exclusively, and a second consumer is refused.
- **Selecting a local file in the rail scrolls to its tool row, not to the expanded chip.** `revealFile` addresses tool rows through `data-file`; making the rail drive the turn-tail expansion needs a channel neither package has yet.
- **The inline diff has no height cap.** Its height follows the change, so a whole-file create renders every line. `DiffBlock` caps a tool row at sixteen lines behind an expand control; this surface does not.
- **The list covers loaded history only** until `Load all` is used. The rail states this rather than presenting a partial list as complete.
