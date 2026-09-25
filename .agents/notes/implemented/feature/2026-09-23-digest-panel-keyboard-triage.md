# Agent Note: Digest panel keyboard triage — arrows, Tab, configurable Enter, digit buttons

Status: implemented

English | [中文](2026-09-23-digest-panel-keyboard-triage.zh.md)

## Problem

The inbox panel had a keyboard ring (`j`/`k` and `↑`/`↓` along the ring, `Enter` opens, `e`/`t`/`p`/`s` for handled, todo, pin, snooze, `Escape` closes), but almost nobody could find it: the only legend was one line under the last section, absent on the board, and no button showed its key. The ring order was also the only geometry: in the wrapped section grid `↓` moved to the card on the right, on the board `←`/`→` did nothing, there was no way to jump a whole section or column, **继续** had no key, and `Enter` was fixed to opening the session.

## Decision

The [panel](../../../../packages/client/ui-digest/src/client/DigestPanel.tsx) keeps the ring for `j`/`k` (plus `Home`/`End`) and adds three other axes over it; the [package README](../../../../packages/client/ui-digest/README.md) owns the user-facing key table.

**Arrows move by on-screen position.** [`neighborCard`](../../../../packages/client/ui-digest/src/client/card-keys.ts) picks, among the cards that overlap the focused one across the arrow's axis and whose centre lies in the arrow's direction, the closest along the arrow. `←`/`→` therefore stay on the row (on the board, they reach the card beside it in the next column) and `↑`/`↓` stay in the column, continuing into the next section only when a card sits straight under the focused one; the edge of a row or column stops the key, so `↓` never drifts sideways to a nearer card in another column. Boxes come from `getBoundingClientRect` at the press; a document without layout (jsdom) reports empty boxes and the ring order stands in.

**Tab jumps groups.** `Tab`/`Shift+Tab` move to the first card of the next or previous populated section or board column while the body or panel root holds focus. At either boundary, native focus traversal reaches the controls, as specified by the [populated-layout decision](2026-09-26-digest-workspace-layout-and-running-work.md). Buttons and fields keep native focus traversal.

**Enter is configurable.** The `ui-digest` settings section gains `enterAction`, one of the six card actions, default `open`, chosen by radio on the **汇总面板** page. The panel runs it on the focused card when the card offers it (a running session cannot be continued, handled, or snoozed; a waiting one cannot be continued or snoozed; pinning follows its master switch) and opens the session otherwise, so `Enter` never dies. `Shift+Enter` always opens.

**Digits press the buttons.** `1`–`6` follow the card's button order (open, continue, handled, todo, pin, snooze) and are refused where the card lacks the button. Every desktop card draws each available button's digit in a `<kbd>` beside the label (aria-hidden, so button names stay plain). The [layout and running-work decision](2026-09-26-digest-workspace-layout-and-running-work.md) keeps those hints visible; only the outlined card receives the key action. The legend line now names the Enter action and appears in both layouts, below the board as well as under the sections. The single-letter chords `e`/`t`/`p`/`s` are gone: they were English mnemonics on a Chinese surface and would have been a second, undrawn scheme.

**The panel takes focus on open.** The toggle chord is pressed wherever the user is typing, usually the composer, which the panel covers but which keeps its focus; keys then count as typing and the panel ignores them. On open the panel root (`tabIndex={-1}`) takes focus, remembering the previous element, and gives it back on close when nothing else took focus in between. The `Tab` guard admits the panel root beside the body.

**Capture-phase digits.** The sidebar pinned area binds bare `1`–`0` to its positions on the same document by default and registers before the panel, so at the bubble phase it would open a pinned session and dismiss the panel. The panel therefore takes the digit keys in the capture phase while it is open on the inbox tab, and every other key in the bubble phase, so a menu or dialog closer to the press still sees `Escape` and `Enter` first. Closing the panel returns the digits to the pinned area.

## Alternatives considered

**Keep or extend the letter chords** (`o` open, `c` continue). No mnemonic survives translation, and the letters were the undiscoverable part.

**Bind `Tab` to the top tabs or the time windows.** The user chose group jumps; `Tab` as a spatial move fits beside the arrows, and the top tabs remain clickable.

**Ring-order arrows with a computed column count.** `grid-template-columns` from `auto-fill` cannot be read without layout either, and the board has columns of unequal height; measured boxes cover both with one rule.

**Change the pinned area's default chords** to free the digits. That would break a shipped default for every user to serve one surface that is only sometimes open; claiming the keys for the panel's lifetime is the smaller intrusion and is stated on the page and in the README.

## Consequences

Stored documents without `enterAction` read as `open`. Users of `e`/`t`/`p`/`s` must relearn the digits; the focused card shows them. Pinned-area digit chords are unavailable while the panel is open on the inbox tab. `Tab` reaches native controls at the ends of the populated groups, and focused native controls keep their own activation keys.

[The card-keys spec](../../../../packages/client/ui-digest/tests/card-keys.client.spec.ts) owns the digit table, availability, and the neighbour search; [the panel spec](../../../../packages/client/ui-digest/tests/panel.client.spec.tsx) owns the measured arrows in both layouts, the focus hand-off on open and close, Tab and its focus guard, the configured Enter and its fallback, the digits ahead of a rival listener, and the keycaps; [the settings spec](../../../../packages/client/ui-digest/tests/digest-settings.client.spec.tsx) and [host spec](../../../../packages/client/ui-digest/tests/host.client.spec.ts) own the radio group and the schema field.
