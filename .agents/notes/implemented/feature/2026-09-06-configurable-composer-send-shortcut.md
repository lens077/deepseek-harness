# Agent Note: Configurable composer send shortcut

Status: implemented

English | [中文](2026-09-06-configurable-composer-send-shortcut.zh.md)

## Problem

Users who compose multiline prompts need Enter to insert a newline without submitting and need send combinations beyond two fixed presets. A send-key preference must remain independent of the choice between Queue and Steer while a session runs.

## Decision

The Host-backed `ui-conversation.sendShortcut` setting accepts `enter`, `mod-enter`, or a canonical explicit combination such as `Ctrl+Alt+S`. It defaults to `enter` and has presets and an explicit-save recorder in Settings > General. The [composer README](../../../../packages/client/ui-conversation/README.md#shell-and-standard-props) owns the keyboard behavior and recording instructions.

The preference selects the send gesture, not the delivery mode. In `enter` mode, Enter uses the preferred busy delivery and Ctrl/Cmd+Enter uses the alternate. In `mod-enter` mode, Enter inserts a newline and Ctrl/Cmd+Enter uses the preferred delivery. An explicit combination sends preferred delivery only on an exact match, including every modifier; Ctrl and Meta remain distinct. Ordinary Enter in custom mode and bare Shift+Enter insert newlines. IME composition does not submit. Empty-draft Ctrl/Cmd+Enter steer-all is limited to the two named modes; custom combinations never flush an empty draft's queue. Pointer actions remain independent.

[Shared shortcut validation](../../../../packages/client/ui-conversation/src/send-shortcut.ts) supplies the Host schema, recorder, and matcher. Explicit combinations require Ctrl, Meta, or Alt and a supported key; modifier order is canonical. The validator rejects reserved editing/browser shortcuts rather than allowing a recorded combination that competes with those actions. Recording is provisional until Save; cancellation leaves the persisted preference unchanged.

The [Queue/Steer decision](2026-07-30-web-queue-steer-action.md) continues to own strict queued-row steering and best-effort composer delivery; this preference only selects which keyboard gesture requests that delivery.

## Alternatives considered

**Limit sending to two fixed presets.** This cannot satisfy users who need another combination for their keyboard or workflow.

**Keep Ctrl/Cmd+Enter on alternate delivery in every mode.** In `mod-enter` mode this would make the only send gesture bypass the user's preferred busy delivery.

## Consequences

The default retains Enter-to-send behavior, and stored `mod-enter` preferences retain their meaning. Other modes give up a separate alternate-delivery send chord; the existing Queue and Steer controls remain available. The preference uses Host settings rather than a browser-local copy, so clients sharing the same settings document share the choice. Accepted combinations can still be intercepted by the OS or browser; validation cannot guarantee delivery of a key event.

[Submission-policy tests](../../../../packages/client/ui-conversation/tests/submission-policy.client.spec.ts) and [InputBar tests](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx) own shortcut matching, delivery selection, newline and IME protection, and empty-draft behavior. The keyless [Settings browser scenario](../../../../apps/web/tests/settings-chrome.e2e.ts) owns persisted selection across reloads.
