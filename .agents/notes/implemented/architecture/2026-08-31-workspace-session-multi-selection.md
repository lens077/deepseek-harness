# Agent Note: Session row range and toggle selection

Status: implemented

English | [中文](2026-08-31-workspace-session-multi-selection.zh.md)

## Problem

Workspace browser Session rows carried no selection concept of their own. A click meant "open", and the only highlighted row was the opened Session, derived from `currentId`. Users who arrive from a file manager expect `Shift` to select a run of rows and `Ctrl` to pick rows individually, and got a sequence of session switches instead.

## Decision

Selection is a viewing set that exists beside the opened Session, never replacing it. A pure model in `selection.ts` owns every transition — plain, toggle, range, toggle+range, select-all, arrow movement, and pruning — as functions over a visible-row sequence, so the semantics are unit-testable without a DOM.

Each list body passes the ids it actually rendered, in render order. Expanded nested children follow their parent; collapsed Workspace or nested branches and rows behind the **Show more** cut contribute nothing. That makes a range span Workspace groups and nested branches while reaching only what the user can see. The grouped tree, flat list, and search results each bind their own sequence.

Apple platforms map the toggle modifier to `Cmd`. `Ctrl`+click is the system secondary click there, so it never arrives as a plain click and cannot carry toggle meaning.

The selection lives in its own non-persisted store rather than the existing Workspace view store. Snapshot-store persistence is whole-value, so any field added to a persisted store survives a reload; a restored selection would highlight rows the user never picked in this visit. The enable flag is a genuine setting and does live in the persisted store, whose key advances for the added field. Because a register declares exactly one store and that seat holds the persisted viewing store, the selection reaches the component through the reserved `hooks` inject compartment — the sanctioned channel for a registrant-private reactive fact.

Only Session rows participate. Workspace header rows keep their expand/collapse meaning.

## Verification

`pnpm run test:gui`, the ui-workspace package tests including a pure-model suite and an assembled-browser interaction suite, and the package TypeScript build.

## Alternatives considered

**Put the selection in the existing view store** — rejected because that store persists whole-value. Suppressing one field would require a partialize path the engine deliberately does not have (the hand-rolled persistence exists precisely because zustand's middleware corrupted whole-value state).

**Compute ranges over the derived data order** — rejected because the rendered order is not the data order: Workspace and nested branches fold, and the overflow cut hides rows. A data-order range would silently select rows the user cannot see and cannot verify.

**Confine a range to one Workspace group** — rejected because Explorer ranges cross folder boundaries, and the browser already presents groups as one continuous scrolling list. Cross-group ranges also keep the flat list and the grouped tree behaving alike.

**Couple batch verbs into the selection model** — rejected. The pure selection model remains independent of every verb; the [selection-aware action layer](../feature/2026-09-02-selection-aware-session-actions.md) resolves the current set, progress, failure, and pruning at the UI edge.

**Add a shared `Switch` primitive for the settings row** — rejected for now because `ui-primitives` exports no toggle today and adding a public component needs sign-off. The row reuses the sibling session-count row's `Menu` selector, so the General section keeps one control idiom.

## Consequences

Selection stays browser-local viewing state: no Host settings schema, no session event, nothing model-visible. Row activation now carries the gesture's modifier flags, so `SessionNodeItem` and `SearchResultItem` report `(id, event)` instead of `(id)`. A modified press suppresses the reorder drag, and a live multi-selection suppresses the row hover card. Disabling the setting clears any live selection, because every clearing gesture is itself gated on the setting.
