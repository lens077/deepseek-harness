# Agent Note: Explicit Session navigation dismisses the Digest overlay

Status: implemented

English | [中文](2026-09-05-session-navigation-dismisses-digest.zh.md)

## Problem

The Digest overlay owns its open state independently from the current Session selection. Its own card actions close the overlay before opening a Session, but sidebar rows, search results, workflow links, and other navigation surfaces call the shared Session runtime directly. Those calls can select a conversation while the Digest remains above it.

A request to reopen the already-current Session leaves `SessionListState.current` unchanged, so a selection observer cannot distinguish the user's navigation request from no action. The conversation is selected but remains hidden behind the overlay.

## Decision

The client runtime emits the typed `sessions/navigated` event after `SessionRuntime.open()` or `openSubagent()` validates the target and selects it. The event represents a successful explicit navigation request rather than a selection change, so repeated requests for the current Session emit again. Startup restoration, reconnect resurfacing, and passive list projection do not emit it. A rejected target throws before the event.

`@deepseek-ai/dsh-client-ui-digest` subscribes from its plugin lifecycle and closes the shared Digest viewing store when the event arrives. The feature retains ownership of its visibility; the generic `center.overlay` slot and ui-layout do not gain Digest-specific policy. `TestSessions` mirrors the event so client feature tests observe the same navigation semantics as the production runtime.

## Alternatives considered

**Observe `SessionListState.current`.** Rejected because the value contains selection state, not navigation intent. It cannot report a click on the already-current Session, which is the failing case.

**Close the Digest in every navigation surface.** Rejected because each opener would need a Digest dependency and a missed caller would restore the defect. The runtime methods already centralize successful explicit Session navigation.

**Move overlay visibility into ui-layout.** Rejected because ui-layout declares a generic composition slot while each overlay owns whether it renders. Centralizing one feature's open state there would couple the shell to Digest policy without removing the need for a navigation signal.

## Consequences

Every successful explicit Session open dismisses the Digest, including a repeated click on the selected sidebar row and a catalog-addressed subagent open. Passive restoration leaves the persisted Digest state unchanged. Dispatch is synchronous, so listeners stay non-throwing; the Digest listener performs only one store action. Feature navigation continues through `open()` or `openSubagent()` rather than mutating `SessionManager` selection directly.

The runtime unit suite pins repeated successful emission and failure silence, the Digest plugin suite pins close behavior and listener disposal, and the keyless navigation-panes browser scenario pins the original sidebar interaction.

## Related

- [Cross-workspace finished-session digest](../feature/2026-09-01-cross-workspace-finished-session-digest.md) owns the overlay and viewing-store design.
- [Inbox card cap and sidebar reveal](2026-09-03-inbox-card-cap-and-sidebar-reveal.md) owns tree reveal and multi-selection behavior when the selected Session value changes.
