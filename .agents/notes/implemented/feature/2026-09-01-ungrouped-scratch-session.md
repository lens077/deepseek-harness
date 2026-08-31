# Agent Note: Explicit Ungrouped scratch sessions

Status: implemented

English | [中文](2026-09-01-ungrouped-scratch-session.zh.md)

## Problem

Starting in the Web client required selecting or registering a Workspace even though the Host already supports `session.create({})` and assigns its default cwd. The no-session Hero therefore treated directory choice as the only route to a live composer, while sessions born at the Host default cwd through other frontends could already exist outside every Workspace account and appear under Ungrouped.

The client needed an explicit start action that preserves the [Host-born Session and Agent-scope parity model](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md), does not infer Workspace membership from cwd, and keeps the resident InputHub draft intact across materialization.

## Decision

The Hero Workspace surface exposes **Start without a folder** beside the Workspace choice. `WorkspacePicker` owns the action's pending and failure presentation and calls the slot owner's `onStartScratch`; it hides the action when the current blank Session is already Ungrouped, so a repeated click cannot mint another hidden blank Session.

The owner delegates to `IWorkspaces.createScratchSession()`. `WorkspaceRuntime` calls `sessions.create()` with no `workspaceId`, allowing the Host to apply its default cwd and leaving the Session outside every `WorkspaceView.sessionIds` account. The method returns the already-addressable Session id but does not navigate. `ui-conversation` owns navigation and shares one transfer path for Workspace selection and scratch creation: it connects or creates the target, moves the current blank Session's draft and staged image ids when possible, and then calls `sessions.open(nextId)`.

Composer inertness depends only on the absence of a Session. A materialized blank Session has the ordinary live input surface whether it belongs to a Workspace, remains Ungrouped, or lost its Workspace account. This partially supersedes the materialization-path assumptions in the [session-scope note](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md) and the [composer picker-entry note](2026-08-07-workspace-picker-composer-entry.md); their scope, resident DOM, and picker-trigger decisions remain active.

## Alternatives considered

**Create a client-only scratch draft before Session birth.** This would introduce a second lifecycle and identity axis. The Host can already atomically create Session + Agent + cwd, so the client remains a mirror of that entity.

**Register the Host default cwd as a Workspace automatically.** Cwd equality is not Workspace membership. Automatic registration would pollute the durable Workspace list and violate the Host's explicit `sessionIds` account.

**Reuse any blank Session with the same cwd.** An Ungrouped Session must not become a Workspace member by inference, and a repeated scratch action must not silently select an unrelated process's blank Session. Scratch creation is explicit and always creates a fresh Host entity.

## Consequences

Users can start chatting without granting or choosing a directory. The Session uses the Host default cwd, appears under Ungrouped after it has content, and remains fully usable by Session-scoped composer features. Workspace lists and membership stay unchanged.

Runtime tests pin the absent `workspaceId` request and addressable response; component and composition tests pin action visibility, pending and failure states, draft transfer, navigation, and Ungrouped composer usability. The assembled keyless Web scenario verifies the visible entry, Host default cwd, editable composer, and absence from Workspace membership.
