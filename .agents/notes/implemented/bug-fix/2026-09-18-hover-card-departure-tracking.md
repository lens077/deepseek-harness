# Agent Note: Hover card closes on pointer departure, not only on boundary events

Status: implemented

English | [中文](2026-09-18-hover-card-departure-tracking.zh.md)

## Problem

The sidebar session and workspace hover card (`HoverCard` in ui-primitives) closed only on three signals: React `pointerleave` on the anchor wrapper, a press inside the anchor, and the owner flipping `disabled`. Every departure that produces no boundary event stranded the card on screen: the row scrolled or reordered away under a resting pointer (Chromium defers hover updates until scrolling ends, so a dwell that fired mid-scroll opened a card beside a row nobody was pointing at), the sidebar collapsed under the pointer, or focus moved to another window. Users saw a card that stayed after the mouse had left. The card also painted a fixed `#2C2C2E` surface with white text in both themes — a Figma value carried over literally — so on the light theme it sat as a dark slab against a white sidebar.

## Decision

`HoverCard` tracks the pointer instead of trusting boundary events alone:

- The wrapper records the last pointer position from `pointerenter` and `pointermove`. When the dwell timer fires, the card opens only if that position still lies inside the anchor rect (`inRect`, edges inclusive), so an anchor that scrolled away during the dwell opens nothing.
- While open, a capture-phase `pointermove` listener on `document` checks the event's `composedPath()` for the wrapper or the portaled card: inside cancels a pending departure close, outside arms one. Arming is once per departure (`awayRef`), so continued motion outside cannot push the grace close back indefinitely.
- The existing capture-phase `scroll`/`resize` listener also re-checks the resting position against the moved anchor and card rects, closing after the grace when neither contains it and keeping the card when an unrelated pane scrolled.
- Window `blur` closes at once.

The surface follows the theme: `--dsw-specific-menu` background with the menu card's `--dsw-elevation-prominent` shadow and `--dsw-alias-border-l1` hairline; the body text in `Rows.module.css` uses `--dsw-alias-label-primary`/`-secondary`/`-tertiary`, and the copied label uses `--dsw-alias-label-primary`.

## Alternatives considered

**Close unconditionally on any scroll.** The capture-phase listener sees every scroll, including the conversation pane auto-scrolling during streaming, which would dismiss a card the user is reading. The rest-position check distinguishes the anchor moving from an unrelated pane moving.

**`document.elementFromPoint` hit-testing.** Would replace rect math, but jsdom does not implement it, and the rect check needs only the two rects the component already measures.

**Keep the fixed dark surface as designed.** The Figma value is identical in both themes, but the product now renders it beside themed menus and tooltips; a dark slab on the light theme reads as a defect, not a design.

## Consequences

- A hover card is never left behind once the pointer moves anywhere outside it; a pointer that rests perfectly still after the anchor vanishes closes on its next motion, on the next scroll, or when the window loses focus.
- Specs for `HoverCard` fire `pointerenter` with coordinates inside the stubbed anchor rect (the `enter` helper), because the dwell now verifies the position; jsdom's default all-zero rects still accept a coordinate-less `pointerenter` at (0,0), so other packages' row specs are unaffected.
- Consumers that supply hover-card body styles should use label tokens; a fixed color would no longer match the surface in one of the two themes.
