# Agent Note: Selection-Aware Session Actions

Status: implemented

English | [中文](2026-09-02-selection-aware-session-actions.zh.md)

## Problem

Session multi-selection initially had no action layer. Adding archive, Workspace membership changes, and permanent deletion requires one rule for what a secondary click targets, where actions appear, which mutations are atomic, and which apparent "move" requests are invalid because a Session's canonical `cwd` cannot change.

## Decision

A secondary click on an unselected active Session replaces the selection with that Session; a secondary click on a selected Session preserves the complete selection. The context menu consumes that resulting set. To keep single-row selection from crowding the list, the separated action bar appears only for two or more Sessions: a selection owned entirely by one Workspace renders it beneath that Workspace header, while ungrouped, search, flat, and cross-account selections render it beneath the sidebar section header.

Archive extends the [registry-global archive set](2026-07-31-session-archive-global-set.md) with one batch mutation. The Host validates every selected id before one archive-set write, so an unknown Session rejects the complete selection. Archived Sessions keep their logs and Workspace accounting positions and appear in a separate Archived view with Unarchive and permanently-delete actions. Archived rows do not participate in active-list selection.

Removing Sessions from a Workspace is one durable membership mutation. It preserves logs and `cwd`, removes only the selected accounting slots, prunes invalid nested placement, and promotes surviving children whose selected parent was removed. A selection may join another Workspace only when it is currently ungrouped and every Session has the same canonical `cwd`. The client reuses a Workspace registered for that path or registers the directory and then attaches the selection. Arbitrary cross-directory movement is not offered.

Permanent deletion uses the separately confirmed, descendant-cascading [Session deletion operation](2026-09-01-irreversible-session-deletion.md). Selected descendants of another selected root are removed before issuing requests, preventing duplicate cascades. Independent roots are deleted sequentially and independently: one root's rejection never cancels the roots after it, because the cascades share no state and abandoning them would strand deletable Sessions behind an unrelated failure. A failure leaves the other roots committed, and the dialog reports the first reason, keeps only the still-undeleted roots selected for a retry, and never claims rollback.

## Alternatives considered

**Move any selected Session to any Workspace** — rejected because Workspace attachment validates canonical `Session.cwd === Workspace.path`. Rewriting `cwd` would change Session execution identity and make retained logs claim a directory they did not run in.

**Implement batch archive as parallel single-Session calls** — rejected because one transport failure could hide only part of the selection. A Host batch method validates first and publishes one durable archive-set change.

**Treat Remove from Workspace as deletion** — rejected because a Workspace owns grouping metadata, not Session logs. Removal is reversible by compatible reattachment and never touches persistence.

**Let archived rows join active-list selection** — rejected because archived browsing is the recovery surface for an archive action. Keeping that view single-row and inverse-focused avoids mixing hidden and active membership states in one gesture.

## Verification

Workspace tests pin atomic archive validation, atomic membership updates, nested-child promotion, and deletion cleanup. Host transport tests pin the RPC schemas and handlers. Runtime and ui-workspace tests pin one-call batch archive projection, selection-aware secondary clicks, action-bar placement, compatible Workspace creation, archive recovery, and deletion-root deduplication.

## Consequences

Selection remains browser-local viewing state as defined by the [multi-selection decision](../architecture/2026-08-31-workspace-session-multi-selection.md); actions read it but do not persist it. Archive and membership actions commit as one registry mutation, while permanent deletion keeps its stronger per-lineage crash-recovery protocol. The UI deliberately gives up arbitrary Workspace movement and bulk selection inside the Archived view to preserve canonical paths and an explicit recovery route.
