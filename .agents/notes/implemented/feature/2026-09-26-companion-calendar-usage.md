# Agent Note: Companion calendar usage preview

Status: implemented

English | [中文](2026-09-26-companion-calendar-usage.zh.md)

## Problem

A detailed usage drawer answers accounting questions but interrupts a quick check of today's activity. Cumulative session totals cannot answer Today, This week, or This month: sessions span dates, retries add traffic, and forks retain inherited history. A calendar summary also needs one explicit timezone and must distinguish missing history from no recorded usage.

## Decision

The companion's localized **Usage overview** button directly opens a compact non-modal popover. **Today**, **This week**, and **This month** pills select tokens, reporting requests, and estimated cost across discovered sessions. **View details** opens the existing all-time drawer at All sessions, retaining This session and Session tree for a selected session. The main Chat usage drawer and token fallback are independent and retain their behavior.

[ui-companion](../../../../packages/client/ui-companion/README.md) owns the trigger, viewport-clamped anchor, dismissal, and remount-surviving period state. The popover has no backdrop, application inertness, or focus trap; outside pointer input, Escape, and Close dismiss it. [ui-chat](../../../../packages/client/ui-chat/README.md#session-usage-and-cost) supplies preview and drawer content through `companion.usage.panel`, with type-only cross-package dependencies. The preview's minute clock exists only while mounted, so an open view follows calendar rollover without a background polling service.

### Dated own-request accounting

[session-stats](../../../../packages/session/session-stats/README.md) owns the dated fold beside cumulative accounting. Host-validated `calendarTimeZone` accepts an IANA timezone and defaults to `UTC`; deployments can select `Asia/Shanghai`. Ledger state uses `stateVersion: 3` and retains the timezone. Restoring a checkpoint from another timezone fails validation rather than relabeling its dates; source-event replay rebuilds them.

The optional wire `calendar` contains `timeZone` and ascending `days`. Each day extends `UsageBuckets` with `date`, `requests`, `incompleteRequests`, `unreportedAttempts`, `unpricedRequests`, and optional `estimatedCost` and `observedCost`; costs use the parent ledger's currency. Dates are Gregorian `YYYY-MM-DD` values assigned from durable Assistant settlement times, compaction-summary times, or unresolved-step closing times. Each retry settlement and recorded compaction request contributes once; assembled and embedded samples remain alternatives, and inherited fork prefixes contribute nothing. Cumulative accounting and UTC pricing-tier semantics remain unchanged.

The [client period rollup](../../../../packages/client/ui-chat/src/client/chat/usage-period.ts) uses the projection's timezone, Monday-based weeks, and calendar months, with every range ending today. Future dates are excluded. Durable Session ids are deduplicated, and the current live projection overrides its list snapshot. The rollup never dates traffic by `session.updatedAt`, redistributes lifetime totals, queries backend totals, or backfills historical sessions.

Missing calendars, mismatched timezones, and pending discovery remain explicit. With no usable calendar, the preview shows em dashes rather than fabricated zeros. Known partial traffic remains visible with a warning; missing snapshots, incomplete or unreported usage, unpriced requests, and mixed currencies withhold complete cost. An absent date in an available calendar means no recorded own-request usage on that date, not proof of no provider activity.

### Decision ownership

This note partially supersedes the [companion usage-menu decision](2026-09-26-companion-usage-menu.md): the menu entry is replaced by direct calendar preview, while its slot ownership, existing detailed drawer, and no-selection accounting remain active. [Own-request governance](2026-09-12-own-request-usage-governance.md) retains cumulative accounting and advisory policy. The [rest companion](2026-09-26-rest-companion.md) and [draggable companion](2026-09-26-draggable-rest-companion.md) retain character and placement decisions. No related note is fully superseded.

## Alternatives considered

**Use session update time or lifetime totals for calendar periods.** A recent title or message can make old traffic appear current, and sessions span multiple dates. Dated own-request observations preserve the request's actual accounting date.

**Open the detailed drawer for every usage check.** The modal drawer retains investigation depth, but its focus containment and larger footprint are unnecessary for three headline figures. A direct non-modal preview keeps the conversation usable.

**Query or backfill all historical sessions when the preview opens.** The preview remains a reader of available projections, not a new totals service or hydration workflow. Missing snapshots remain visible limitations rather than hidden work or invented zeros.

**Merge dates from different timezones or retain a stale checkpoint after changing the zone.** A date label alone cannot be converted between zones. The Host rejects stale timezone-bound state, and the client discloses mismatched snapshots instead of combining incompatible periods.

## Consequences

Calendar checks are compact and do not alter model calls, Session events, or the existing all-time drawer. Storage grows with contributing dates and retains route/hour buckets for current-table pricing, not provider invoices or historical rate revisions. Cold snapshots can remain unavailable or stale until their ordinary projection lifecycle refreshes them. The preview intentionally shows less detail and cannot establish complete provider spending.

## Verification

[Ledger tests](../../../../packages/session/session-stats/tests/usage-ledger.spec.ts) and [Loader tests](../../../../packages/session/session-stats/tests/loader-composition.spec.ts) own date assignment, timezone validation, stale-checkpoint rejection, retry and compaction counting, fork exclusion, and pricing completeness. [Period tests](../../../../packages/client/ui-chat/tests/usage-period.client.spec.ts) own day/week/month ranges, year and daylight-saving boundaries, future-date exclusion, deduplication, missing calendars, timezone mismatch, and cost suppression.

[Companion interaction tests](../../../../packages/client/ui-companion/tests/companion.client.spec.tsx), [entry tests](../../../../packages/client/ui-companion/tests/menu.client.spec.tsx), and [adapter tests](../../../../packages/client/ui-chat/tests/companion-usage.client.spec.tsx) cover direct entry, period selection, focus restoration, and detailed-drawer reuse. The adapter tests cover midnight refresh and timer cleanup; the [popover tests](../../../../packages/client/ui-companion/tests/popover.client.spec.tsx) cover inside/outside pointer dismissal and listener teardown. The assembled [companion](../../../../apps/web/tests/companion.e2e.ts) and [usage-governance](../../../../apps/web/tests/usage-governance.e2e.ts) scenarios own browser integration and recorded UI evidence. These links identify verification owners, not a claim that a particular run or new browser snapshot has passed.
