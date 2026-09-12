# Agent Note: Irreversible Session Deletion

Status: implemented

English | [中文](2026-09-01-irreversible-session-deletion.zh.md)

## Problem

Archiving hides a Session while retaining its log, and deleting a Workspace registration preserves every Session by design. Neither action lets a user remove sensitive conversation bytes or discard a Session lineage that is no longer needed. A destructive operation must define ownership, live-work rejection, descendant semantics, crash recovery, Workspace accounting, and stale-client behavior across both persistence backends.

## Decision

`session.delete({ sessionId })` permanently deletes the requested Session and the full transitive closure of `SessionHeader.parentSession`, including ordinary forks and subagent descendants. The Workspace registry builds one complete lineage view from persisted, live, and already inspected headers, rejects conflicting identities or cycles, and fixes a deterministic child-first order before changing state.

The registry reserves every target in memory before retiring anything, which blocks delayed attach or create publication into the subtree. An idle ordinary Agent may be retired only through the exact `AgentHandle` held by the ApiProxy instance that created or resumed it. "Resumed" includes the implicit cold resume the shared Agent resolver performs for generic verbs, so the resolver hands every handle it opens to its owning Host through `onResumed`. Without that the resolver was the sole holder, and a Session brought online by an ordinary read — opening one in the sidebar is enough — stayed live but undisposable and could never be deleted, on that attempt or any later one. The ApiProxy releases a handle on `agent/disposed`, matching on agent identity so a stale row cannot reject a later same-id lifecycle. A running Agent, a live Session without that ownership capability, or any target that remains live rejects the entire request before the durable deletion marker or physical deletion begins. This preserves active work and prevents the deletion path from claiming ownership of config-created Agents or independently owned subagents.

The registry then writes `pendingMutation: { operation: 'delete-sessions', sessionIds }`. Recovery replays that exact child-first list after restart. Each physical delete is idempotent for an already absent or lazily unmaterialized Session, so a crash after deleting only a prefix converges on retry. After every artifact is absent, one registry update removes the ids from all Workspace `sessionIds` accounts, the global archive set, cached headers, and valid or invalid path indexes, then clears the marker. Workspace registration deletion remains metadata-only as defined by the [Workspace registration deletion decision](2026-07-27-workspace-registration-deletion.md).

`SessionPersistence.delete(id)` is an irreversible, non-cancellable operation. Its coordinator waits for retirement, serializes with the id's persistence work, rejects a live owner or exclusive preparation, discards a non-exclusive preparation, and returns whether a materialized artifact existed. JSONL removes the complete session-owned encoded directory without following a symbolic link or junction and synchronizes the retained project directory on POSIX. SQLite uses `BEGIN IMMEDIATE`, validates the schema, deletes the `sessions` row, relies on the foreign-key cascade for physical event rows, and commits atomically.

The wire publishes permanent removal as `host/session-deleted`; `host/session-removed` remains process-local detach only. Unary success and the Host frame carry the complete committed id list. The client keeps process-lifetime tombstones, removes every Session-keyed projection, scope, catalog, address, interaction, job, and selection entry, filters stale list responses, and ignores late Host or mux frames. The sidebar exposes the action in active and archived Session rows. Its Chinese confirmation distinguishes archive from deletion, states that persisted bytes and all visible descendants are removed irreversibly, remains non-dismissible while pending, and stays open on failure.

## Alternatives considered

**Delete only the selected Session.** Rejected because a fork or subagent log can retain the same sensitive history. Leaving descendants also creates parent references to an identity that no longer exists. Full transitive deletion matches the user's lineage-level intent and uses child-first order for resumable cleanup.

**Automatically stop any live Agent.** Rejected because a Session's presence in the live registry does not grant disposal authority, and cancelling running work to satisfy a destructive request can lose unobserved output. Only an exact ApiProxy-owned idle handle is admissible; every other live target rejects before the durable marker.

**Keep a durable tombstone instead of removing bytes.** Rejected because the product requirement is erasure of the persistence artifact, not another hidden state. Process-lifetime tombstones exist only to prevent stale client or delayed publication races and are not the durable result.

**Cascade from Workspace registration deletion.** Rejected because a Workspace record owns only grouping metadata, not its directory, user files, or Session logs. The separately named Session action has its own confirmation and never deletes the Workspace directory.

**Emit a persistence-layer deletion event for every derived index.** Rejected because the persistence service owns artifacts, not every derived store. Workspace-owned indexes are cleared by the durable orchestration, while rebuildable Session-query indexes reconcile against the persistence snapshot on their next stable observation. The product-facing committed notification belongs on the Host wire.

## Consequences

A successful response means the selected lineage artifacts and Workspace references are gone and cannot be restored by unarchiving or reconnecting. The operation gives up root-only cleanup and deletion of running or independently owned live Sessions in exchange for explicit ownership, restart convergence, and a committed byte-removal guarantee. A deleted id remains blocked from resurrection for the lifetime of the Host and browser processes; a later process may reuse an absent id, although ordinary creation uses fresh random identities.
