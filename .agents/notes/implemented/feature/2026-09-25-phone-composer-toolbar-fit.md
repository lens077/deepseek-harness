# Agent Note: Phone composer toolbar fits its controls

Status: implemented

English | [中文](2026-09-25-phone-composer-toolbar-fit.zh.md)

## Problem

The phone composer toolbar kept every control on one non-wrapping row ([mobile compact note](2026-09-20-mobile-compact-and-pure-ui.md)). Plugin chips then joined the trailing group: the model-routing switch, the image-model chip, the context meter, and the send-gesture chip. Their labels did not shrink, and the trailing group right-aligns its controls with `justify-content: flex-end`, so the overflow extended leftward and drew the right-hand chips over the command, attachment, and permission buttons. The model name was reduced to one or two characters.

## Decision

Phone toolbar chips are icon-only, with the model name as the one text label. The permission chip drops its label and chevron and fills the 36px touch square with its glyph. The routing and image-model chips drop their labels at the permission chip's existing 460px container cut on the composer row, so narrow desktop panes collapse them the same way. The unconfigured image-model chip is hidden on phones because its explanation exists only in a hover title. The send-gesture chip is hidden on phones. The same choice remains in Settings, and the phone sends with the button.

The row stays on one line while it fits and otherwise wraps, instead of overflowing. On phones the model chip is `width: 0` with a 64px `min-width`, so the trailing group's intrinsic width is its fixed controls plus that floor rather than the full model name. The row wraps only when the left group and that floor cannot share a line; the trailing group then takes a full second line. With the routing switch, the context meter, and the stop button present, 360px and 390px screens keep one row and 320px screens wrap.

## Alternatives considered

**Scroll the chips horizontally in one strip.** Rejected: the permission and busy-Enter menus position inside the toolbar, and a horizontal scroll container clips them vertically. Routing every chip menu through a portal would change desktop behavior for a phone layout.

**Keep the row unwrapped and use `justify-content: safe flex-end`.** Rejected: safe alignment moves the overflow to the end side, which pushes the send button past the card edge instead of fixing the overlap.

**Move secondary controls into an overflow menu.** Rejected: slot contributions render their own controls, and moving them into a menu would need a new slot contract for menu rows. Icon-only chips and the wrap fallback need only CSS.

## Consequences

The change is presentation only; it adds no Session event, model-visible input, setting, or slot. A phone user changes the send gesture in Settings. The wrap fallback also keeps the toolbar usable when a future plugin adds another chip.

## Verification

Local Playwright captures of the served GUI at 320px, 360px, 390px, and 1280px show one row without overlap at 360px and 390px, a clean two-line wrap at 320px, and an unchanged desktop toolbar. The ui-conversation input-bar and skeleton suites and the ui-model-selection, ui-model-routing, and ui-image-gen suites pass.
