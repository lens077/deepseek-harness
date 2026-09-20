# Agent Note: Sizable Chat action column and a full-height turn rail

Status: implemented

English | [中文](2026-09-18-chat-action-column-size-and-full-turn-rail.zh.md)

## Problem

The transcript's right edge carries two floating surfaces: the question-navigation control column (search, load-all, previous, next, back-to-bottom) and the turn rail beside it. Three defects came out of enlarging those controls from 34px to 42px.

Transcript content ran underneath them. The scroller's side padding was a fixed `composer clearance + 16px`, so a right-aligned number, a wide table, or any full-bleed row reached the viewport edge and the controls painted on top of it.

The rail could not show a session's turns. Its height was capped at `min(natural, band - 64px, 420px)` and centred in the whole band, so a long session showed roughly four marks with the rest scrolled out of sight, and nothing said the ladder continued. The 22px mark hit areas also overhung the 6px ladder inset, so a rail at rest reported 5px of scroll it could not use.

The control size was a hardcoded constant, so a reader who needs larger pointer targets had no way to ask for them, and a reader who wants the reading width back had no way to undo them.

## Decision

**One size preference drives the whole column.** `ChatSettings` gains `actionControlSize` (integer CSS pixels, 26–58, default 34 — the size the column carried before it became adjustable), validated by the Host schema. `ActionControlSizePolicy` mirrors it into a browser store beside `TranscriptViewPolicy`, and a General Settings row zooms it in 4px steps. The zoom grid is anchored on the default rather than on zero, so 34 and the 42 that prompted this work both stay reachable and the range ends sit on the grid. `clampActionControlSize` keeps zoom arithmetic on one accepted answer at the ends.

`ChatView` republishes the value as `--dsh-chat-action-size` on its root. The control column, the rail width, the tick geometry (`--turn-tick`, scaled at 0.48/0.7/1.4/1.6 of the size), the search panel's offset, and the transcript gutter all read it, so the column moves as one object.

**The gutter is symmetric and reserved.** `.scroll` padding becomes `max(composer clearance + 16px, size + 32px)` on both sides. Both sides widen together because a one-sided reserve shifts the centred message column off the composer's axis; the phone breakpoint restores the plain padding, where the column parks above the composer instead of beside the transcript. Measured live, the transcript's content box holds a constant 28px gap from the controls at 34px and at 50px.

**The rail fills the column above the controls.** `QuestionNavigator` observes its own rendered height and reports it; `ChatView` writes it to `--dsh-chat-action-column` directly on the root element rather than into React state, because that value only CSS reads and a render per resize would ride every streaming commit. The rail derives `--turn-rail-free` from the band minus that column and its offsets, drops the 420px cap, and centres inside the free span — a rail that grows tall can no longer reach the controls. `RAIL_INSET_PX` moves from 6 to 12, half a mark's hit area, so a rail at rest reports no phantom scroll.

**Placement is the reader's choice, and stacking is the default.** Most sessions hold few Turns, so the rail no longer spends a column of transcript width by default: `turnRailPlacement` (`stacked` | `column`, default `stacked`) and `turnRailAlignment` (`top` | `center` | `bottom`, default `top`) join the same durable section, and one Settings row offers the four destinations as a list, because stacking has no alignment of its own. A stacked rail shares the controls' column and ends one gap above them, so the newest Turn's tick stands over the search control and the ladder rests at its newest end rather than its oldest. A rail in its own column keeps the previous behaviour, may use the whole band, and starts from the end its alignment names. The transcript's reserve follows: one control width for stacking, two for a rail with its own column.

**The question panel opens upward.** It was anchored at the control column's top, which was the top of the screen while the column lived there. With the column at the composer floor the panel began near the viewport floor, ran off the bottom, and left its list no bounded height, so a wheel over it moved nothing. The panel now anchors to the column's floor, caps at the room between that floor and the top of the transcript band, and its list contains its own overscroll so reaching the end does not scroll the transcript behind it.

**Both columns are anchored the same way.** The rail became `position: fixed` and offsets from the composer floor like the controls do. Positioned against the scroller it missed their column by the scrollbar gutter — 8px on this host — which is exactly the alignment the stacked placement is for.

**Paging entries mark the overflow.** Wheel scrolling already reached the ladder; `.edge` buttons now appear at whichever end can still scroll and page it by 80% of the frame. They are flat, unlike the round elevated pills below them, because they only move the ladder while those run transcript commands.

**The browser checks the size it is handed.** `adopt()` validates `actionControlSize` instead of trusting the section type: a Host older than the field publishes a section without it, and the derived `NaN` collapsed the entire column to zero width. `actionSizeStyle` applies the same guard, because a custom property's declared fallback does not rescue an invalid value.

## Alternatives considered

**A one-sided right gutter.** Reserves less space, but the message column is centred in the padded box, so an asymmetric reserve visibly slides the transcript off the composer's axis.

**Deriving the control-column height in CSS from its entry count.** The column's entries change (load-all arrives and leaves), and the rail is its sibling, not its descendant; measuring the rendered column is the only answer that stays correct without duplicating the entry rules in two places.

**Anchoring the rail at the bottom and starting it scrolled to the newest turn.** Shipped once and rejected by the user as disorienting. The rail keeps its centred resting position and its existing active-mark follow; only its ceiling changed.

**Menu of named sizes instead of a px stepper.** The request was zoom in and out with px values; a stepper reads the current pixel size directly and needs no naming scheme for nine steps.

## Consequences

- The Host half registers the schema, so a running `dsh web` must restart before the new field persists; until then the browser falls back to 34px and the Host rejects the write.
- Any future surface in that gutter should read `--dsh-chat-action-size` rather than restate a pixel size, and offset from the composer floor rather than from the scroll box.
- The rail's resting ladder position now depends on placement: stacked rests at its newest Turn, its own column at the end its alignment names. It is applied once per placement, so a reader who scrolls the rail keeps their position.
- `packages/client/ui-chat/tests/action-control-size.client.spec.ts` pins the snap grid, both range ends, the Host-skew fallback, and adoption; `action-control-size-row.client.spec.tsx` pins the stepper and its disabled ends; `chat-apply.client.spec.tsx` pins both registrations and their injected faces; `turn-rail-layout.client.spec.ts` pins per-field persistence, snapshot identity, and the fallback for values an older Host publishes, and `turn-rail-layout-row.client.spec.tsx` pins the four destinations. The rail geometry expectations in `chat-view.client.spec.tsx` move with the new inset.
