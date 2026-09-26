# Agent Note: Home/End move the caret in the composer and other text fields

Status: implemented

English | [中文](2026-09-24-home-end-caret-in-text-fields.zh.md)

## Problem

macOS binds Home and End to `scrollToBeginningOfDocument:` / `scrollToEndOfDocument:`, and Chrome and Safari apply that binding even while a text field or `contenteditable` holds focus. A user typing in the composer who pressed Home watched the transcript jump to the oldest question instead of the caret moving to the start of the line. Nothing in the GUI bound those keys; the browser default was the whole behavior.

## Decision

The composer claims Home and End for the caret. Home goes to the start of the caret's line and End to its end; Ctrl or Meta widens the reach to the whole draft; Shift extends the selection from its fixed end so a backward selection stays backward. Alt is left alone because the workspace pin shortcuts own Alt+Home. A send shortcut bound to Home or End still submits: the gesture the user configured wins, and caret motion is the fallback.

The motion is computed from the EditorState, not from the DOM. [`caret-motion.ts`](../../../../packages/client/ui-conversation/src/client/input/editor/caret-motion.ts) folds the selection to detect offsets through the existing composer projection, takes the line boundary there, and applies the result through a direction-preserving `$selectDetectPoints`. Lexical's `RangeSelection.modify` was the obvious alternative and is rejected below.

"Line" means a logical line — the text between newlines — so a soft-wrapped paragraph counts as one line. Wrapped-line geometry lives only in the rendered box, and the composer's own text is short enough that reaching the real ends of a line is the useful gesture. A reference chip occupies one detect position, so a line edge can never land inside a chip.

The GUI's other `<input>` and `<textarea>` fields get the same gesture from one document-level listener, governed by the Host-backed `ui-conversation.homeEndInTextFields` setting (default `true`, selectable in Settings > General). The listener runs in the bubble phase and returns on an already-handled press, so the composer keymap, the digest panel, and the shortcut recorders keep the keys they claim. Focus outside a text field keeps the browser's scrolling, which is the behavior that makes Home and End useful for reading a long transcript.

The listener covers the input types that expose a text selection (`text`, `search`, `url`, `tel`, `password`) and every textarea, skipping read-only and disabled fields. `email`, `number`, and the date family report a null selection and reject `setSelectionRange`, so they stay with the browser.

## Alternatives considered

**Call `RangeSelection.modify(alter, isBackward, 'lineboundary')`.** Rejected: it delegates to the non-standard `Selection.modify`, which jsdom does not implement, so the behavior could only be asserted against a mock rather than the editor, and the per-file coverage gate would have been satisfied by a fiction. The model-level computation is testable through the same projection the rest of the composer uses.

**Make the composer behavior configurable too.** Rejected: the platform binding it replaces is a defect for anyone typing, not a preference. The setting exists for the fields the conversation plugin does not own, where a user may prefer the browser default.

**Send Home to the start of the whole draft.** Rejected: multi-line drafts are ordinary in this composer, and a gesture that cannot address one line forces arrow-key walking. Ctrl/Cmd keeps the whole-draft reach available.

**Install the listener from a shell package instead of `ui-conversation`.** Rejected for now: the conversation plugin already owns the GUI's text-entry keyboard preferences (send shortcut, busy Enter, question-navigation focus policy), and a second owner would split one keyboard policy across two packages. A future app-shell keyboard owner should take both.

## Consequences

Home and End no longer scroll the transcript while a text field has focus, on macOS or anywhere else. A user who relies on that scroll while typing can set `homeEndInTextFields` to `false` for the surrounding fields; the composer keeps the caret motion either way.

The durable `ui-conversation` section gains one boolean field. It defaults to `true`, so an existing settings document adopts the new behavior on read without a migration.

[The Home/End spec](../../../../packages/client/ui-conversation/tests/home-end-caret.client.spec.tsx) owns the line boundaries, the EditorState motion, the keymap gesture, the document listener, the preference policy, and the Settings row.
