# Agent Note: Session archive (registry-global set)

Status: implemented

English | [中文](2026-07-31-session-archive-global-set.zh.md)

## Problem

The session row menu in the sidebar workspace browser carried a purely visual "Delete session" placeholder (no handler). The product decision is **archive**, not delete: the session log and its workspace accounting stay untouched; the session merely disappears from every grouping surface (workspace groups, Ungrouped, search, the flat list). The archive record needs a home: an Ungrouped session belongs to no workspace entity, so a per-workspace field cannot carry it.

## Decision

**The archive set is a new field on the workspace domain's global singleton (`workspaceDomainState.archivedSessionIds`), layered over workspace accounting; display filtering converges entirely in the client's `tree.ts` derivation layer; the wire surface uses the full-snapshot posture.**

- Storage: `archivedSessionIds: z.array(sessionId).default([])`, domain version stays 2 — a purely additive field; pre-field media parse to an empty set through the schema default, no migration code. An archived session keeps its `sessionIds` slot, so unarchiving restores its accounted position and the set never touches the one-owner accounting invariant.
- Registry: `ctx.workspaceRegistry.archiveSession(id)` and `unarchiveSession(id)` ride `enqueueOperation`, serialized with every registry mutation. Archive requires a live or persisted session, throws `WorkspaceUnknownSessionError` otherwise, and skips an existing member without writing or emitting. Unarchive removes a member and treats an absent id, including an unknown id, as an unwritten no-op so stale archive entries remain clearable. The `archivedSessionIds` getter exposes the read-only Host-ordered set.
- RPC: `workspace.archiveSession({sessionId})` and `workspace.unarchiveSession({sessionId})` both answer `{archivedSessionIds}` with the full updated set. The `workspace.list` response carries the set as the reconnect baseline; `host/archived-sessions-changed` pushes the full snapshot after every durable change (same posture as `host/workspace-changed`, emitted from the `domain/changed` global-put branch by set comparison). Unknown archive targets reuse the `session-not-found` error code; unarchive preserves target-state idempotence.
- Client runtime: `WorkspaceListState.archivedSessionIds` is a `readonly SessionId[]` in Host order whose reference changes only with membership. Public snapshot state stays in the store engine's plain-data vocabulary because immer drafts reject Sets without the MapSet plugin; membership lookups build a transient Set in the derivation. The list baseline, both unary echoes, and the changed frame each install the complete set. The projection sweep clears the current selection whenever it lands in the archive set, returning to the New Session view — one rule covering the local archive echo, another tab's changed frame, and a reconnect baseline restoring a selection archived while this client was away. Unarchive does not reopen a Session. A frame or echo landing during an in-flight `workspace.list` shields the newer set, including removals, from the stale baseline.
- UI: an active Session row offers non-danger **Archive session** without a confirmation dialog. `tree.ts` filters archive members from grouped, Ungrouped, search, and flat views through one predicate. The **Archived** presentation follows Host set order, retains Workspace context and top-level blank rows, hides subagent-origin rows, and exposes only **Unarchive session**. A successful action leaves its row busy until the full-set projection removes it; a rejection stays visible inline and can be retried.

## Alternatives considered

**Per-workspace archivedSessionIds (the original phrasing).** Rejected: Ungrouped sessions have no home; the user switched to global.

**An archived flag on SessionSummary (session.list layer).** Rejected: it joins a workspace-domain fact into the sessions-domain projection, summaries have no incremental frame so a separate notification would still be needed — cross-domain coupling outweighs the saving.

**Host-side filtering in `workspaceView`/the `sessionIds` getter.** Rejected: archiving ≠ changing accounting, and filtering the projection muddles the two concepts; a future restore surface also needs the client to see full accounting.

**Incremental frames (single archived/removed rows).** Rejected: the set is tiny and changes rarely; full snapshots spare the client merge logic and dedup state and match the existing workspace-changed posture.

## Consequences

Archived Sessions remain present in the Session list and Workspace accounting but are reachable only through the dedicated archived presentation; rows there cannot open, select, rename, fork, or reorder a Session. The `workspace.list` response change remains a pre-release direct edit with no compatibility layer. The workspace-management e2e pins archive, reload recovery, archived browsing, unarchive, original-position restoration, and a second reload. Domain tests pin both mutations' idempotence, archive unknown-id rejection, unarchive absent-id tolerance, restart recovery, and the pre-field media default upgrade.
