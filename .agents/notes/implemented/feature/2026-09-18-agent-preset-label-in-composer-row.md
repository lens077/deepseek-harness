# Agent Note: The agent-preset label moves to the composer tool row

Status: implemented

English | [中文](2026-09-18-agent-preset-label-in-composer-row.zh.md)

> Amends one placement in [per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md): the read-only label that names what a running session runs. That note's decisions — the staged new-session chip, the logged preset id, the host's refusal to switch a started session — are unchanged. Only where the label reads is different.

## Problem

The read-only preset label sat in the session header, in the `conversation.session.header.actions` band right after the title. Two costs came with that seat. The title's own rule capped it at 220px, so a title longer than about fourteen CJK characters ellipsized even on a wide window while the band beside it held a chip and empty space. And the header groups per-session *navigation* facts — lineage, tabs, the session log — while the preset is a *run* fact, the same kind as the access mode and the model that already read in the composer tool row.

## Decision

**The label registers into `conversation.input.right`**, the trailing group of the composer tool row, at `order: -10` so it leads the group: preset, then model, then send. It is sized like the model trigger beside it (28px chip, 13/20 medium secondary, `max-width: min(360px, 45cqw)` under the row's inline-size container) so the row reads as one band, and it stays static chrome: no button, no menu, the same `title` hint as before.

**The label hides while the session is blank.** The composer is mounted on the new-session screen too, and the hero chip there already names the staged preset and is the one place to change it; a second copy in the tool row would read as a control that is not one. The label reads `blank` from the same session summary that carries the preset, so the two facts cannot tear.

**The current title takes the header width it has.** Ancestor crumbs keep their 220px cap so a deep lineage never starves the current segment; `.crumbCurrent` sets `max-width: none` and the ancestor segments `flex: none`, so the current title grows to its full text and ellipsizes only when the row is narrower than that text. No JavaScript measures anything.

## Alternatives considered

- **Widen the title cap to a larger constant.** Any constant is wrong at some window width; the flex rule above is the constant-free version and costs three declarations.
- **Keep the label in the header and shrink it.** The header still spends width on a run fact next to a navigation cluster, and the title still competes with it.
- **Show the label on blank sessions as well.** The chip and the label would name the same preset side by side, one a control and one not.

## Verification

- `packages/client/ui-agent-preset` specs: the apply spec registers and disposes the entry under `conversation.input.right`; the component spec covers the blank-session hide and the no-roster-read that comes with it.
- `apps/web/tests/agent-preset-selection.e2e.ts`: the header golden no longer carries the preset; a new `composer.expected.md` golden captures the trailing group with the label before the model select and the send button, and asserts it is not a button.
- Driven from a temporary `dsh web` on this checkout: a 34-character title shows whole at 760px and ellipsizes at 600px; the blank-session hero shows the chip alone.

## Consequences

- Anything that registered into `conversation.session.header.actions` expecting to sit after the preset (the jobs action does today) now leads that band.
- The composer trailing group has one more occupant whose width scales with the row; a long user-authored preset name ellipsizes inside its chip rather than pushing the model trigger.
