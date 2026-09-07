# Agent Note: fork placement reaches the wire and fork children stay controller-owned

Status: implemented

English | [中文](2026-09-06-fork-placement-and-controller-owned-fork-children.zh.md)

## Problem

The upstream restructure moved the Web fork and delete endpoints from the apiproxy gateway into `dsh-api-session-controller`, and two pieces of the fork contract did not survive the move.

The Client `SessionManager.fork` sent only `sessionId` and `atSeq`. `ClientSessions.fork` still accepted `placement` and spread it into the manager call, but the manager's parameter type had no such field and its request literal dropped it, so a "new nested child session" from the Workspace browser always reached the Host without a placement and attached as a sibling. The Host also lost the guard that pre-merge attachment had: a `nested` request was passed straight to `workspace.attachSession(child, { nestUnder: source })`, which rejects a source the Workspace does not account — every subagent source, since those attach through their nearest Workspace-owning ancestor.

The Host fork command created the child through `ctx.agents.create` directly and discarded the returned handle. `ApiSessionAgentController.retire` — the capability the Workspace registry calls before permanent deletion — disposes only handles the controller owns, so deleting a live fork child (or a lineage containing one) failed with `session "…" is live but not owned by the Session Controller`.

## Decision

`SessionManager.fork` carries `placement` to the wire exactly as it carries `atSeq`; the wire type already declared the field.

The fork command publishes its child through a new `ApiSessionAgentController.createSeeded`, the same `own()` path `ensureSession` and `resolveAgent` use, so the controller holds the disposer for every Agent the Web plane created. Nested placement is applied only when `workspace.sessionIds` lists the source; otherwise the child takes the sibling slot, restoring the pre-merge degrade documented on `SessionForkRequest.placement`.

## Alternatives considered

**Retire through `ctx.agents.get(id)` without an owned handle.** Rejected: the registry exposes no disposer for an Agent another owner published; retiring by identity would let the Web plane tear down subagent-owned or ACP-owned Agents it never created.

**Fail a nested fork of an unaccounted source with `workspace-attach-failed`.** Rejected: the child is already published when attachment runs, so a failure leaves a fork the browser then reconciles as an error; the sibling slot keeps the operation total, as it was before the merge.

## Consequences

`session-fork.host.spec.ts` pins nested attachment for an accounted source, the sibling degrade for a subagent source, and fork-then-delete through the controller's retire path; `sessions-service.client.spec.ts` pins `placement` on the wire. The test remote gains `delete`.

Not changed here: a fork of a subagent still lands in the nearest Workspace-owning ancestor's sibling slot (pre-merge behavior, pinned by the `subagent-conversation` Web e2e golden), and fork failures are still swallowed by the Chat and Workspace browser callers.

## Related

- [SessionStore fork API](../../archived/feature/2026-06-30-session-store-fork-api.md) — the fork boundary and lineage rules this endpoint applies.
