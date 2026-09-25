# Agent Note: Digest board layout and reply visibility toggle

Status: implemented

English | [中文](2026-09-22-digest-board-layout-and-reply-toggle.zh.md)

## Problem

The digest inbox stacked one section per state top to bottom, and every card carried the closing answer in a fixed-height scrolling body. A user running many sessions at once reads the inbox for one question — which sessions need a decision from me right now, and which just finished — and the stacked arrangement answered it only after scrolling past whichever section happened to be long. Sessions moving between states also moved every section below them. The answer text made each card tall enough that a few sessions filled the panel.

## Decision

The [viewing store](../../../../packages/client/ui-digest/src/client/stores.ts) gains two persisted preferences: `layout` (`sections` or `columns`, default `sections`) and `showReply` (default `true`). The persist key moves to `dsh.digest.view.v3` because rehydration replaces the whole value, so a stored v2 document would otherwise leave both fields `undefined`.

`columns` is the board: [`selectColumns`](../../../../packages/client/ui-digest/src/client/select.ts) regroups the sections `selectInbox` produced into columns in decision order — waiting on the user, finished (unread and seen together), running, failed — each sorted by last activity newest first. The [populated-layout decision](2026-09-26-digest-workspace-layout-and-running-work.md) supersedes empty-column reservation and owns how populated columns share space. It reads the sections rather than the rows so the window, workspace filter, handled visibility, and pin admission rules stay in one place; a pinned row keeps its state's column and a handled row joins finished or failed by outcome. The keyboard ring follows whichever arrangement is on screen. The board is desktop-only: phones list one column of rows anyway, so `mobileView` ignores the stored layout and the toggle is not offered there.

`showReply` off removes a settled card's closing reply and its truncation hint and clamps the question to two lines; running-work details remain visible; the head, changed files, and every action stay, so triage does not change, only density. The toggle is on the desktop toolbar and, on phones, inside the overview toolbar and the small layout's 更多操作 menu. The [package README](../../../../packages/client/ui-digest/README.md) owns the user-facing behavior.

## Alternatives considered

**Replace the sections with the board.** The sections read well when one state dominates and on phones; the user asked for an added arrangement, and both persist per browser.

**Give pinned rows their own column.** The board's value is a fixed place per state; a pinned column would take an equal-width slot from a state and move pinned rows out of the column that says what they need. The pin mark and `5` key still work in place.

**Independent card-level reply disclosure.** A per-card expander keeps the tall default the toggle exists to escape; the reply is one click away in the session, which 打开会话 reaches from every card.

## Consequences

The key legend sits in a compact footer outside the scrolling content in both layouts; populated board columns scroll independently. Below a 920px center column the board falls back to two columns and the panel body scrolls as a whole. Nothing model-facing changes.

[The selection spec](../../../../packages/client/ui-digest/tests/select.client.spec.ts) owns column grouping and order; [the panel spec](../../../../packages/client/ui-digest/tests/panel.client.spec.tsx) owns the layout toggle, the board's ring and actions, the reply toggle in both arrangements, and the phone behavior.
