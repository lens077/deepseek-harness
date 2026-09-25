# Agent Note: A browser-local rest companion in reserved navigation space

Status: implemented

English | [中文](2026-09-26-rest-companion.zh.md)

## Problem

A decorative character can offer companionship during work, but arbitrary floating placement can cover the composer or conversation. Animation can also distract, particularly on phones. This interaction has no task or model meaning and does not justify network requests or durable session history.

## Decision

The [rest companion](../../../../packages/client/ui-companion/README.md) starts in the sidebar's reserved `sidebar.footer.action` space. Desktop navigation provides the expanded area; the phone header and collapsed rail provide a still, clickable button. This default placement stays outside the composer. The [draggable companion decision](2026-09-26-draggable-rest-companion.md) partially supersedes the placement restriction by allowing explicit user-controlled movement; the local-only behavior and bundled-asset rationale remain unchanged.

One plugin-owned presentation store holds the click-driven `idle → greeting → sleeping → idle` cycle, minimization, and manual motion preference. Responsive remounts retain that state; page reload resets it. Compact layouts and hidden pages pause motion, and reduced-motion preferences disable animation. Minimization in the expanded sidebar leaves a restore button; compact navigation buttons keep the mood cycle instead of opening an overlay.

The package makes no model calls, writes no session events, and supplies no sound, timer, or notifications. Two locally processed WebP assets from the user-supplied blue chibi maid whale reference are embedded in the browser bundle rather than fetched from an external image service. The [web-app row](../../../../packages/bundle/web-app/cordis.patch.yml) is disabled by default so deployment activation remains explicit.

## Alternatives considered

**Start the character at an arbitrary floating position.** Reserved default placement avoids covering conversation content and composer controls without requiring the user to move it first; explicit movement is covered by the draggable companion decision.

**Represent greetings and rest as session or log events.** Those events would imply task or model meaning that the decoration does not have. Client-only presentation keeps both session history and model context unchanged.

**Fetch or generate artwork through an external image service.** Bundled local assets avoid runtime credentials, external image requests, and service availability dependencies for a decorative control.

## Consequences

The docked expanded companion consumes navigation space, and its state does not survive reload or synchronize between browsers. Docked compact presentation trades animation and expanded controls for an unobstructed phone and rail layout.

The package publishes no runtime invariant: a single local presentation store supplies the interaction state, without independent observations that can diverge. Artwork provenance does not grant an upstream character license; redistribution requires separate rights verification.

## Verification

The [interaction specs](../../../../packages/client/ui-companion/tests/companion.client.spec.tsx) encode mood cycling, minimize/restore focus, compact interaction, and motion controls. The [plugin lifetime spec](../../../../packages/client/ui-companion/tests/browser-plugin.client.spec.ts) checks declaration-aware registration and removal of contributions, dictionaries, and listeners. The [assembled browser scenario](../../../../apps/web/tests/companion.e2e.ts) verifies keyboard interaction, readable state snapshots, composer separation, reduced-motion rendering, responsive state retention, short-window controls, and the unchanged four-item phone navigation.
