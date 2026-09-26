# Agent Note: Content-sized Digest card rows

Status: implemented

English | [中文](2026-09-26-digest-content-sized-card-rows.zh.md)

## Problem

A sole populated Digest state fills the available vertical space. Fractional grid rows stretch its cards while a separate 264px body cap prevents summaries from using that space. This leaves a scrolling summary above a large blank interval and distant action buttons; fewer Sessions or a taller window makes the interval larger.

## Decision

The [Digest grid](../../../../packages/client/ui-digest/src/client/DigestPanel.module.css) packs content-sized rows at the top in Sections and single-state Board layouts. Cards and actions align within each row, but separate rows size independently. Max-content tracks retain their height inside a scrolling Board column rather than compressing several rows into one viewport. Remaining panel space stays outside the cards. This refines the vertical allocation in the [populated-layout decision](../feature/2026-09-26-digest-workspace-layout-and-running-work.md), while retaining its column preference, state grouping, and keyboard order.

The card's content-viewport ceiling bounds its scrollable body; the body has no independent fixed cap. A running summary can display tasks, updates, jobs, and metrics when they fit. The [viewport-cap decision](2026-09-03-inbox-card-cap-and-sidebar-reveal.md) still owns the pinned head and action row. Its viewport-relative sizing and the 240px cap floor protect controls in short windows. Phone disclosures and multi-state Board scrolling retain their existing behavior.

## Alternatives considered

**Fill sparse cards to the viewport.** Filling space without more information separates the controls from their content. Removing only the body cap still stretches short cards for no reading benefit.

**Keep the independent 264px body cap.** A medium-length running summary can need more height even when the window has room. The card's viewport ceiling already bounds long content and protects actions.

**Use independent masonry cards.** Unequal card heights within a row weaken action alignment and spatial keyboard navigation. Row-local sizing preserves the existing reading order without imposing the longest row's height on every other row.

## Consequences

Long closing answers can make their own row approach the viewport ceiling; other rows remain content-sized. The existing Show results toggle retains a compact triage view. No Session data, subscriptions, preferences, or shortcut behavior changes.

The [browser layout regression](../../../../apps/web/tests/digest-layout.e2e.ts) covers sparse rows, singleton filters, independent row heights, summaries beyond 264px, and body scrolling with stationary actions in short windows. The [recorded navigation scenario](../../../../apps/web/tests/navigation-panes.e2e.ts) checks compact settled cards with results shown and hidden in both layouts. Existing responsive checks retain column fitting, narrow screens, themes, and phone disclosure.
