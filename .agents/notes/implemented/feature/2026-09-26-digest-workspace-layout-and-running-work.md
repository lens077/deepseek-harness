# Agent Note: Digest workspace layout and running work

Status: implemented

English | [中文](2026-09-26-digest-workspace-layout-and-running-work.zh.md)

## Problem

A digest containing only running Sessions needs its available space for those Sessions, not empty state columns. Uneven card bottoms and an unbounded workspace strip make that space hard to scan. The initial question alone also cannot explain what an agent is doing or how much work it has recorded.

## Decision

The [digest panel](../../../../packages/client/ui-digest/README.md) allocates space only to populated states. A sole state uses the full card-grid width in either layout; the [content-sized-row decision](../bug-fix/2026-09-26-digest-content-sized-card-rows.md) owns its vertical allocation. Cards per row is configurable in Digest panel settings from one through eight, default five. The browser-local preference caps the card count; available content width can reduce it to preserve a readable 240px minimum, or one full-width track in a narrower container. Aligned card edges and action rows preserve row-major reading order. The keyboard legend sits outside the scrolling content. This supersedes the empty-column allocation and footer placement in the [board decision](2026-09-22-digest-board-layout-and-reply-toggle.md), while retaining its grouping, phone behavior, and closing-result preference.

The feature contributes its workspace preference to the existing Layout settings slot and shares the panel's browser-local viewing store. Single row is the default and supports horizontal scrolling and mouse dragging. Limits of two through six rows constrain maximum height without reserving empty rows. Show all removes the row-count limit; viewport-relative scrolling still protects space for cards. Temporary expansion changes neither the saved preference nor the active filter. A drag suppresses its trailing click only after movement crosses the threshold.

Running cards consume the existing Host-wide Session projections and visible-job snapshots. Agent tasks and checklist counts describe the current list; steps and tool totals are explicitly cumulative. Own-session accounting takes precedence over whole-log statistics, whose fallback identifies inherited history. Missing data does not become zero progress. The latest recorded update is committed visible assistant text, not reasoning or a live token stream, and can precede an automatic continuation. Jobs are visible to the Session and may include unowned jobs. No new history subscriptions, model calls, Session events, or Host restart are required.

Keyboard selection retains Session identity through reordering. Every desktop card keeps its available 1–6 button hints visible so the shortcut map remains discoverable; the outline identifies the only card those keys act on. Compact button padding and keycaps let actions wrap naturally by their text and available card width without clipping labels. Native controls keep Enter, Space, and their focus traversal. Group-jumping Tab returns to native traversal at either boundary, including a singleton group; it does not trap keyboard users away from filters. This supersedes the wrapping behavior in the [keyboard decision](2026-09-23-digest-panel-keyboard-triage.md), not its spatial arrows or configurable card actions.

## Alternatives considered

**Keep empty status columns for stable positions.** Their positions do not help when one state owns every Session; reserving them reduces useful card width. Populated states retain a stable relative order instead.

**Use masonry or fill blank space with placeholder cards.** Masonry separates visual and keyboard order; placeholders provide no work information. Equal card tracks preserve both the actual Session count and reading order.

**Subscribe to every Session history for exact current tool text.** Existing pushed projections already carry tasks, committed updates, and cumulative accounting. Additional subscriptions would make opening the digest scale with every retained history. Exact current-step or tool-execution claims require a separate bounded authoritative projection, not inference from unmatched calls.

**Synchronize the row preference through Host settings.** This preference sizes one browser's viewport and belongs beside the existing browser-local board and result-visibility preferences. It introduces no server schema or mutation permission requirement.

## Consequences

The result toggle hides closing answers but keeps running work visible. Tall or numerous workspaces scroll within the strip even in Show all mode; short card viewports scroll rather than clip action controls. Detailed transcripts remain one explicit Session navigation away. The [selector tests](../../../../packages/client/ui-digest/tests/select.client.spec.ts), [workspace tests](../../../../packages/client/ui-digest/tests/workspace-filter.client.spec.tsx), [work-summary tests](../../../../packages/client/ui-digest/tests/work-summary.client.spec.ts), and [browser scenario](../../../../apps/web/tests/digest-layout.e2e.ts) cover populated states, overflow interaction, truthful accounting, and real card geometry. The [recorded navigation scenario](../../../../apps/web/tests/navigation-panes.e2e.ts) owns the finished-digest output.
