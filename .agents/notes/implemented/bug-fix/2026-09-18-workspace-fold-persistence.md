# Agent Note: Workspace folds persist across loads and reveals

Status: implemented

English | [中文](2026-09-18-workspace-fold-persistence.zh.md)

## Problem

Users with many Workspaces found every visited Workspace expanded on each load even after folding it. The sidebar's `groupExpansion` record was persisted, but two mechanisms erased or overrode folds. First, `defineStore` rehydrated a persisted value whole, so every state field addition had to bump the persist key (`dsh.workspace.view` reached `v12` in twelve bumps, five within one week), and each bump discarded every fold, order, and preference the user had set. Second, the [sidebar reveal](2026-09-03-inbox-card-cap-and-sidebar-reveal.md) wrote `setGroupExpanded(key, true)` into that persisted record, and the group holding the current Session was persisted as expanded when it had no record; opening a pinned, digest, or search Session inside a folded Workspace therefore undid the fold permanently. A Firefox profile inspected during diagnosis held fourteen `true` entries and no `false` under `v12`, while its stale `v11` value still carried folds.

## Decision

`createSnapshotStore` rehydrates a persisted plain-object value as `{ ...init, ...stored }` (`rehydrate` in `packages/client/store/src/index.ts`); primitives and arrays still rehydrate whole. A field addition keeps the persist key because the new field starts at its initial value; only a change to an existing field's meaning or type bumps the key, and the `StoreSpec.persist` JSDoc states that rule. The merge keeps stored keys the initial value lacks so optional-field stores such as `SessionSelection` (`{}` initial) still restore.

In `SessionTree` (`WorkspaceBrowser.tsx`), `groupExpansion` records only user decisions: a header toggle, or starting a Session from a Workspace's ＋. A transient `revealedGroups` state — session-local like the expand-all list and folded branches — carries the group holding the current Session while it has no record, and every reveal. `expandedGroups` is the union of persisted `true` records and `revealedGroups`; a reveal inside an explicitly folded group therefore shows the row for that visit. Folding a header removes the group from `revealedGroups` and writes `false`, so a fold hides the current Session's row (the folder keeps its active tint) and the next load starts from the persisted folds alone.

## Alternatives considered

**Keep whole-value rehydration and stop bumping the key.** A required field added later would read `undefined` at runtime, which the whole-value rule existed to prevent; the merge removes the reason for the bump instead.

**Merge only the initial value's keys.** Drops stored keys the initial value lacks, which breaks stores whose initial value is `{}` with optional fields; keeping every stored key costs at most a stale key until the next write.

**An accordion (expanding one Workspace folds the others).** Changes the model for every user rather than honoring the folds this user set; it remains possible as a view option on top of the persisted record.

**Fold the revealed group back when the current Session leaves it.** Would close a Workspace the user is still reading; the reveal lasts until the user folds it or reloads, matching the other transient states.

## Consequences

- Folds, orders, and preferences survive client upgrades that add store fields; a persist-key bump is now a deliberate reset reserved for incompatible field changes.
- A Session opened from the pinned area, digest, or search still becomes visible, but its Workspace returns to the persisted fold on the next load.
- `workspace-browser.client.spec.tsx` pins the transient reveal, the untouched record, the fold that hides the current row, and the remount that starts from persisted folds; `store.client.spec.ts` pins the merge, the optional-field restore, and whole-value array rehydration.
