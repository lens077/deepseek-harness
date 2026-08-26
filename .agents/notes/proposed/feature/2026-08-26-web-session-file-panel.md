# Agent Note: Web session file panel and inline side-by-side diffs

Status: proposed

English | [中文](2026-08-26-web-session-file-panel.zh.md)

## Problem

The Web client shows a session's file mutations only where they happened: one diff card per `edit`/`write` tool row, plus the closing turn's produced-file chips from [ui-deliverables](../../../../packages/client/ui-deliverables). Reviewing what a session did to the workspace therefore means scrolling the whole transcript and reconstructing the per-file story by hand, and a long session buries the answer under hundreds of steps. Nothing shows which files the agent is touching right now, and nothing collects one file's repeated edits into a single place. The existing diff surface — [`DiffBlock`](../../../../packages/client/ui-primitives/src/DiffBlock.tsx) — stacks the removed block above the added block, which reads well for one small hunk inside a message flow but not for comparing a file's before and after.

## Proposal

A **session file panel**: a left rail inside the conversation area that lists what this session read and changed, plus an inline side-by-side diff surface in the transcript that the rail navigates to. The rail is navigation and status; the diffs live in the transcript, where the full column width exists.

### The two seats

The surface needs two render positions, so [ui-conversation](../../../../packages/client/ui-conversation) declares two seats rather than one. A single seat cannot serve both: the control belongs in the tab row while the pane must participate in the session's layout, which a portal out of the tab row cannot do.

`conversation.session.tabs.leading` is a list seat rendered before the tablist, and the tab row's `tabs.length > 1` render gate widens to also render when that seat is occupied — with no occupant the row's behavior is unchanged, which a test pins.

`conversation.session.rail` is a single seat rendered by `ConversationRoot` **between the session header and the scrollport**, not by the session body inside it. A pane inside the scrollport is a flex item of a box as tall as the whole transcript: it stretches to that height and scrolls away with the conversation. The split wrapper is rendered only for an occupied seat, so an unoccupied rail leaves the scrollport a direct child of the session column and keeps the `min-height: 0` chain the transcript depends on untouched.

### Entry point

A `文件` / `Files` toggle button sits immediately left of the `Chat` tab, carrying a count badge of the files this session changed, replaced by a spinner while the agent runs. A blank session shows neither button nor rail.

### The rail

The rail is a split inside the conversation column rather than a frame-level column: [AppFrame](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) already owns a three-column concession chain, and the rail must open directly below its own button rather than at the far right of the window. Width is user-draggable between 240px and 560px, defaulting to 300px; closing it removes the column entirely and leaves the button. The open/closed choice persists in `localStorage`: open on first use, and thereafter whatever the reader last chose.

Row labels drop their **head**, not their tail. A session's files differ at the end far more often than at the start — a document and its translation are `notes.md` and `notes.zh.md`, and a dated series shares its whole prefix — so a trailing ellipsis renders distinct files as the same string. The cut is computed from a character budget scaled to the rail's current width, with the CSS ellipsis left in place as a backstop.

Two regions:

**Changed** lists one row per file, oldest first, so the newest change is at the bottom. The file currently being written carries a loading icon. While idle the last-changed file is selected by default. Clicking a row scrolls the transcript to that file's diff — the running tool row while a call is in flight, the expanded chip afterwards. What counts as a change is [ui-deliverables](../../../../packages/client/ui-deliverables)' existing rule, unchanged: a `card: 'diff'` view, or a `card: 'generic'` view whose `kind` is `edit`. Failed calls and deletes contribute nothing.

**Read** sits below Changed, collapsed by default behind a `Read N files` count. It admits only the `read` tool's `card: 'generic'` / `kind: 'read'` locations. It keeps the most recent twenty entries and clears when the agent goes fully idle, not at each `turn/end`: a multi-turn task would otherwise blank the list several times while the reader is watching it precisely to see what the agent is doing.

### The diff surface

Two triggers put a diff in the transcript, both rendering the same component:

- A file-path mention in the assistant's own prose expands in place, under the existing conservative match in [ui-deliverables](../../../../packages/client/ui-deliverables/src/client/turn-deliverables.ts): an exact path, or a basename exactly one produced path carries. An abbreviated path such as `.../foo.yml` stays inert; the rule is not relaxed, because a mention that opens the wrong file is worse than one that does nothing.
- The closing turn's produced-file chips become expandable, so a file the prose never named is still one click from its diff. The chips row keeps its existing six-chip fit-and-count behavior.

Every changed file of a turn expands by default — a written file's diff is what the reader came for — and the *File change comparison* row in General settings offers **Expand only a single file** and **Keep every file closed** for readers who want less. The preference is durable through `settingsScope`, reactive so a change reaches transcripts already on screen, and outranked per file by the reader's own toggle. Reads are absent from the vocabulary: a file that was only read has no comparison to open.

The diff itself spans the full transcript width in two columns, before on the left and after on the right, its height following the content. Each hunk's two sides are paired line by line with blank-line padding so that corresponding lines sit level, which the stacked `DiffBlock` does not need and does not do. Lines do not wrap; the two columns scroll horizontally in lockstep, because independent scrolling would destroy the alignment the pairing exists to create.

### Diff basis

The panel shows **this session's accumulated changes to a file**, assembled from the contextual hunks already in the session log, in the order they happened. Each segment is labelled with its turn and tool (`Turn 3 · Edit`), because an accumulated view without provenance cannot distinguish one call that changed two places from two calls that changed one place each.

Two host-side facts fix this basis. Whole-file `before`/`after` exists only inside the host process: [`createSuccessResult`](../../../../packages/core/tools/src/index.ts) feeds the structured value to `render` and `presentationMeta` and then drops it, and [`ToolResult`](../../../../packages/core/tools/src/index.ts) carries only `content`, `isError`, and `meta` — the browser's [`ToolResultBlock`](../../../../packages/llm/llm/src/types.ts) is narrower still. And [`computeHunkDiffs`](../../../../packages/fs/tool-fs/src/diff.ts) discards `structuredPatch`'s line numbers, so hunks carry no anchor by which they could be sorted by file position or merged where they overlap. Chronological order with provenance labels is what the recorded data supports.

### Scope: two cuts

The first cut is the two seats, the rail, the derivation, `SideBySideDiff`, and the transcript's inline diff, for the current session alone.

The derivation reaches the transcript as `chatFileDiffs`, an optional service declared by ui-conversation, provided by this package, and consumed by ui-deliverables through `ctx.get` — the mirror of the `chatFileMentions` face that already travels the other way between the same three packages. A produced-file chip expands its diff when the service reports a recorded change and keeps its opener when it does not, so the surface degrades to today's behavior rather than producing an inert click.

What the rail does on selection is the one place the first cut falls short of the design: it scrolls to the last tool row carrying the path as `data-file` rather than to the expanded chip. Driving the turn-tail expansion from outside the turn needs a channel neither package has, and the tool row already renders that file's change.

The second cut extends the panel to **session-tree changes** — the union of this session's changes and those of every descendant subagent session. Subagent work is invisible to the local derivation by design: a child works in its own session and the parent log records only the delegation tool call and result ([tool-subagent](../../../../packages/subagent/tool-subagent/README.md)). The extension reads [`subagent.list`](../../../../packages/host/apiproxy/src/api/subagents.ts) and `subagent.history`, which serve live and cold children alike and carry render intents, recursing through `hasChildren` to the whole tree; keeps one row per file with each segment labelled by its source (`reviewer · Turn 3 · edit`); subscribes to each running child's event stream for live status; and expands a child's diff in place under the parent's delegation row rather than navigating away.

History depth has one switch. Opening the panel loads the current session's most recent page and each first-level completed child's most recent page. A `Load all` control loads the current session's full history and recurses the whole subagent tree. Subscription to running children is not behind that switch — it serves live status, not history depth.

The read, the merge, and the rail's use of both have landed. Live status is not a per-child subscription: `events.mux` is one aggregated stream the runtime owns exclusively and refuses a second consumer, and the signal worth reacting to is a child's last step rather than its every step — so the rail re-reads the tree when the catalog mirror's running-child count drops.

The delegation-row expansion has not landed, and cannot from the browser as things stand. Placing a child's diff under the call that spawned it needs a delegation-call to child-session mapping, and none is reachable: `SessionSummary` and `SubagentListEntry` carry `parentSessionId` and no spawning call or turn, and the delegation tool declares no `presentationMeta`, so nothing machine-readable about the child reaches the session log. Closing it means recording the child session id in that tool's `presentationMeta` — a Host change that would serve only sessions recorded after it. Until then a descendant-only file appears in the rail with its segments in the merged model but has nowhere to draw them in the transcript, because the inline surface hangs off a turn's produced-file chips and such a file never appears in one.

## Blast radius

| Change | Where |
|---|---|
| New client plugin: rail, button, derivation, dictionaries, invariant companion | `packages/client/ui-session-files/` |
| Two slots, the widened tab-row render gate, and the rail split above the scrollport | [ui-conversation](../../../../packages/client/ui-conversation) |
| Line-paired two-column diff with synchronized horizontal scroll | [ui-primitives](../../../../packages/client/ui-primitives) |
| `data-file` on the tool row, the rail's scroll target | [ToolRow](../../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx) |
| `chatFileDiffs` optional service | [conversation slot contract](../../../../packages/client/ui-conversation/src/client/contract/slots.ts) |
| Produced-file chips expand their diff | [ProducedFiles](../../../../packages/client/ui-deliverables/src/client/ProducedFiles.tsx) |
| Browser roster entry | [web-app bundle patch](../../../../packages/bundle/web-app/cordis.patch.yml) |
| Regenerated slot and config catalogs | [cordis-client-runner](../../../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts), [config catalog](../../../../docs/config-catalog.md) |

## Alternatives considered

**A whole-file diff from the session's first `before` to its last `after`.** The preferred basis on its face, and rejected on evidence: the whole-file texts never leave the host process, so the client cannot compute it and no existing session contains the data. Carrying them would mean widening `presentationMeta` to persist both full file texts on every mutation — a 200KB file edited thirty times writes twelve megabytes into a log that is replayed, ZIP-exported, and paged over RPC — and it would still show nothing for sessions recorded before the change.

**Diffing against git `HEAD`.** Rejected: it answers a different question. `HEAD` includes edits from other sessions and from the reader's own hands, and the panel's subject is what *this* session did.

**Reusing the `details` right column.** The column already has drag, a concession chain, and close-without-unmount. Rejected because it is a `kind: 'single'` slot already occupied by the tool details inspector, so sharing it would mean rewriting that owner into a multi-view container, and because a button at the top left opening a panel at the far right reads as a bug.

**A fourth AppFrame column.** The orthodox placement, rejected for cost: [`computeColumns`](../../../../packages/client/ui-layout/src/client/columns.ts) is a pure three-column concession solver, and a fourth track means re-deriving the whole chain and its tests for a panel that does not need frame-level width arbitration.

**A third view tab beside Chat and Trajectory.** Rejected: `conversation.view` renders one view at a time, and the panel's value is watching files change *while* reading the conversation.

**Rendering the diff inside the rail.** Rejected: at 240–560px two code columns are unreadable, so the rail would need a second, stacked rendering of the same content — two render sites for one thing, which drift.

**Placing the button in `conversation.session.header.actions` or `.utilities`.** Both avoid touching ui-conversation's skeleton. Rejected: entry-point position is the one visual requirement this feature has, and neither slot is left of the Chat tab.

**Replacing the produced-file chips row with diff blocks, or appending blocks below it.** Rejected: the chips row is already the complete per-turn file list with fit-and-count elision, so making it expandable adds the diff without a second list or a reply tail dozens of screens long.

**Two unaligned columns, or keeping the stacked `DiffBlock`.** Unaligned columns misread as soon as the two sides differ in length, which is the normal case; keeping the stack declines the side-by-side comparison this note exists to add.

**Rendering the rail inside the session body, beside the active view.** The first placement tried, and wrong: the session body is inside the scrollport, so the rail became a flex item of a box 11,509px tall and scrolled off the top with the transcript. The rail belongs above that box, between the header and the scroll container.

**Truncating row labels with `direction: rtl`.** The one-line CSS way to move an ellipsis to the front, and rejected on measurement: an rtl paragraph reorders a leading digit run, so `2026-08-25-notes.md` renders as `notes.md-2026-08-25`. A leading LRM did not restore the order. A character budget computed from the rail's width is approximate where the CSS was exact, but it is not wrong.

**Admitting `grep`/`glob` hits to the Read list.** Rejected: a search produces a hit list, not files the agent opened, and one grep can match hundreds of paths, which would make the `Read N files` count meaningless.

**Clearing the Read list at each `turn/end`.** Rejected: a task spanning several turns would blank the list repeatedly during exactly the activity the list exists to show.

**Loading the whole subagent tree eagerly while leaving the parent's history paged.** Rejected as an asymmetry that fails silently: a subagent's old changes would appear while the parent's own older changes stayed hidden, and the reader has no signal that anything is missing. One switch governs completeness for both.

## Acceptance criteria

The button renders left of the Chat tab, and the tab row's behavior with no `tabs.leading` occupant is byte-identical to today. The rail opens by default on first use, honors a persisted closed choice, and drags between its bounds. Changed lists every mutated file oldest-first with the running file spinning, and clicking a row scrolls the transcript to that file's diff. Read stays collapsed behind its count, admits only `read` locations, caps at twenty, and survives a turn boundary while clearing at full idle. A single-file turn shows its diff expanded; a multi-file turn shows all collapsed. A two-column diff pairs its lines level and scrolls both columns together, and each segment names its turn and tool. A session whose history is paged states that older changes are unloaded and offers `Load all`.

## Risks

The tab-row render gate and the rail split are the two edits with regression reach: both sit in a shipped package's skeleton and every session renders through them. Each keeps the unoccupied tree exactly as it is today, and a test pins that.

The label budget estimates glyph width rather than measuring it, so an unusually wide name can still reach the CSS ellipsis and lose its tail. The estimate is deliberately pessimistic to keep that rare.

The inline diff has no height cap: its height follows the change, as specified, so a whole-file create renders every line and a single-file turn expands it on arrival. `DiffBlock` caps a tool row at sixteen lines behind an expand control; if the reply tail proves too long in use, that cap is the precedent to copy.

The first cut shows nothing for turns whose work was delegated, which is a large share of sessions in practice. This is understood and accepted as the price of splitting the work; the second cut removes it.

Loading the full subagent tree and subscribing to every running child are both unbounded in the tree's width: a task with many concurrent children opens many paged fetch chains and many event subscriptions. The `Load all` gate bounds the fetches; the subscriptions are bounded only by how many children run at once.

Aggregating across a long session recomputes on every snapshot update, so the derivation must be memoized against the conversation snapshot rather than run per render.
