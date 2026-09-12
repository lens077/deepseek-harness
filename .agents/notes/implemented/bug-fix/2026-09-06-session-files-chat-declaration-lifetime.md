# Agent Note: Session Files follows the Chat declaration lifetime

Status: implemented

English | [中文](2026-09-06-session-files-chat-declaration-lifetime.zh.md)

## Problem

The Session Files button and rail consume Chat hooks, but their conversation-shell slots can exist without Chat. Registering those consumers solely against the shell slots lets a composition without `ui-chat` mount components whose required hooks are unavailable.

## Decision

The [Session Files plugin](../../../../packages/client/ui-session-files/README.md) nests its button and rail registrations under the `conversation.chat.node` declaration lifetime. The existing Files visibility preference still controls both registrations within that lifetime. Removing Chat removes both consumers; restoring Chat permits them to register again. Their required hook types remain unchanged.

## Alternatives considered

**Supply dummy Chat hooks when Chat is absent.** Rejected because fallback data masks a missing registration and does not bind the consumers to the provider's lifetime. An unavailable optional feature leaves its UI seats empty instead.

## Consequences

The conversation shell can compose without Chat without mounting the Chat-dependent Files controls. This changes registration availability, not file derivation, persisted Files preferences, or Session data. The existing [file-panel decision](../feature/2026-08-26-web-session-file-panel.md) retains ownership of those behaviors.

## Verification

The package regression exercises Chat absent, present, and absent again, checking that the button and rail follow the declaration lifetime without weakening their hook requirements.
