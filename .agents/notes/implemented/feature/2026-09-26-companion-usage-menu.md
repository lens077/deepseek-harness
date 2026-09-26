# Agent Note: Open existing usage views from the companion menu

Status: implemented

English | [中文](2026-09-26-companion-usage-menu.zh.md)

## Problem

The companion needs an explicit entry to DSH usage without replacing its character interactions or creating another accounting implementation. Usage remains useful when no session is selected, but that state supplies neither a current ledger nor a governance policy.

## Decision

The menu-entry decision is partially superseded by the [calendar-usage preview](2026-09-26-companion-calendar-usage.md): a separate **Usage overview** button directly opens the compact preview, and **View details** opens the existing drawer at All sessions. This session and Session tree remain available in that drawer when a session is selected. Character clicks, dragging, minimization, docking, and local motion preferences retain their behavior.

[ui-companion](../../../../packages/client/ui-companion/README.md) owns `companion.usage.panel`, a `single`, `session-maybe` child slot whose owner props carry the requested calendar period or detailed scope, scope changes, and dismissal. [ui-chat](../../../../packages/client/ui-chat/README.md#session-usage-and-cost) registers a private adapter through declaration-aware injection. Chat has only a type-only development dependency on the companion; neither package runtime-imports the other. The drawer mounts only while opened, and dismissal restores the persistent usage trigger. Open state lives in the companion store so responsive remounts retain the view. An absent provider produces an unavailable notice in the non-modal preview.

The adapter reuses `UsageLedgerDrawer`, rollup logic, localized copy, and missing, pending, unpriced, and cold-snapshot warnings. All sessions reads discovered list projections without creating or selecting a session, fabricating a ledger, or inferring policy from another session. This entry adds no backend calls or aggregation service. [Own-request usage governance](2026-09-12-own-request-usage-governance.md) retains accounting and advisory-policy ownership.

This is an enhancement to the [rest companion](2026-09-26-rest-companion.md), not a replacement of its local-state, bundled-artwork, or no-model guarantees. The [draggable companion decision](2026-09-26-draggable-rest-companion.md) retains placement ownership. These related decisions remain active; none is fully superseded.

## Alternatives considered

**Use character clicks to open usage.** A separate entry preserves mood cycling and the distinction between clicks and dragging, including compact layouts.

**Import Chat components into the companion or duplicate accounting there.** A child slot keeps the companion independent of Chat runtime values and leaves accounting, warnings, and drawer behavior with their existing owner.

**Create a placeholder session or borrow another ledger's policy for global usage.** Discovery supplies the available observations, not authority to invent a current session or its governance settings. Missing data remains explicit.

## Consequences

Usage gains a navigation entry outside the composer without changing model requests or session history. The extra usage button occupies companion space, and all-session totals remain limited to discovered snapshots rather than a complete provider invoice. Deployments without the usage provider retain character controls but cannot display usage through that slot.

## Verification

The [companion interaction specs](../../../../packages/client/ui-companion/tests/companion.client.spec.tsx) own usage-entry availability and separation from character controls. The [adapter specs](../../../../packages/client/ui-chat/tests/companion-usage.client.spec.tsx) and [rollup specs](../../../../packages/client/ui-chat/tests/usage-rollup.client.spec.ts) own no-selection aggregation, absent policy, and incomplete-data disclosure; [registration specs](../../../../packages/client/ui-chat/tests/chat-apply.client.spec.tsx) own declaration-aware contribution disposal.

The assembled [companion scenario](../../../../apps/web/tests/companion.e2e.ts) owns keyboard entry, global usage without selection, focus restoration, compact layout, and retained character interactions. The [usage-governance scenario](../../../../apps/web/tests/usage-governance.e2e.ts) owns persisted session/tree/all scope integration and uncertainty disclosures. These are verification owners, not a record of passing runs.
