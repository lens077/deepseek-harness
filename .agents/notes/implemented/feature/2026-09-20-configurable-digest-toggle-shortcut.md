# Agent Note: Configurable digest panel toggle shortcut

Status: implemented

English | [中文](2026-09-20-configurable-digest-toggle-shortcut.zh.md)

## Problem

The sidebar digest entry toggled its panel on one fixed chord, `Ctrl+1`. Browsers and window managers claim `Ctrl+digit` for tab switching on some platforms, users with the [customizable send shortcut](2026-09-06-configurable-composer-send-shortcut.md) already expect keyboard gestures to be theirs to set, and a user who wants the inbox on one bare function key had no way to say so.

## Decision

The `ui-digest` settings section gains `toggleShortcut`, a canonical `[Ctrl+][Meta+][Alt+][Shift+]Key` string defaulting to `Ctrl+1`, recorded on the **汇总面板** settings page by pressing the chord into a read-only field and saved on the spot. [The toggle chord library](../../../../packages/client/ui-digest/src/toggle-shortcut.ts) supplies the Host schema pattern, the recorder, the matcher, and the command-modifier test; the [package README](../../../../packages/client/ui-digest/README.md) owns the user-facing behavior.

A chord may carry zero modifiers. This is what separates it from the send shortcut, which requires Ctrl, Meta, or Alt because it lives inside the composer: the toggle listener is on the document, so a bare key or a Shift chord is admitted and then kept silent inside editable fields by the same test the panel's single-letter triage ring uses, while a chord with Ctrl, Meta, or Alt stays live everywhere, which is the reach-the-inbox-mid-sentence behavior the fixed chord had. The settings page states which of the two the current chord is.

Supported keys are letters, digits, F1–F12, arrows, Home, End, PageUp, and PageDown; the physical `KeyX`/`DigitN` code wins over the produced character so a layout that shifts the digit row still reaches the chord. The recorder refuses editing keys (Tab, Backspace, Delete, Enter, Space, Escape) and the letters editing or the browser owns under Ctrl or Meta without Alt (clipboard, undo, select-all, find, tab and window control, text-style toggles), because a chord that fires inside the composer would hijack those rather than merely shadow a page shortcut. The Host schema pattern enforces canonical modifier order and the key set; the browser policy reads a stored chord the recorder would refuse as the default, so a hand-edited `settings.yaml` cannot bind `Ctrl+C`.

## Alternatives considered

**Reuse the send-shortcut library.** Its modifier requirement and legacy presets are composer facts; the digest chord's bare-key admission and editable-field guard are document-listener facts. Sharing would mean exporting a runtime value across two feature plugins, which the client export rules forbid.

**Allow several alternate chords.** No consumer asked for more than one; one field keeps the page and the schema plain. A list can replace the string field later without a format migration.

**Require a modifier, as the send shortcut does.** That would refuse the bare function key that motivated the change.

## Consequences

Stored documents without the field read as `Ctrl+1`; nothing changes for users who never open the page. The panel's key legend and the entry's tooltip name the configured chord instead of fixed copy. A modifierless chord is unreachable while typing, by design; the page says so. As with the send shortcut, the OS or browser may still intercept an accepted chord.

[The toggle chord spec](../../../../packages/client/ui-digest/tests/toggle-shortcut.client.spec.ts) owns the pattern, recorder, and matcher; [the panel spec](../../../../packages/client/ui-digest/tests/panel.client.spec.tsx) owns the entry following a configured chord and the editable-field guard; [the settings spec](../../../../packages/client/ui-digest/tests/digest-settings.client.spec.tsx) owns recording, refusal, and reset.
