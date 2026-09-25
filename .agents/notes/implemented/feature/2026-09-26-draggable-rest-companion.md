# Agent Note: User-controlled placement for the rest companion

Status: implemented

English | [中文](2026-09-26-draggable-rest-companion.zh.md)

## Problem

Reserved navigation space prevents automatic obstruction, but a fixed companion location does not let the user choose where it sits. Moving the character must remain distinct from greeting it, and the character needs a reachable way back to navigation.

## Decision

The [companion](../../../../packages/client/ui-companion/README.md) starts docked and allows explicit mouse, pen, or touch dragging. A primary-pointer movement of at least 6 CSS pixels detaches it to a fixed viewport position and suppresses the resulting click. Ordinary clicks retain their mood-cycle or restore action. Focused arrow keys move the character by 16 CSS pixels; **Home** and the floating **Dock** control restore navigation placement. The Dock control remains available in compact presentation.

The [drag handler](../../../../packages/client/ui-companion/src/client/useCompanionDrag.ts) clamps position after movement and viewport or companion resizing. Visual viewport resize and scroll observations also constrain placement when a software keyboard or zoom changes the visible area. Position belongs to the existing local presentation store: responsive remounts retain it, while reload resets it to docked. Dragging pauses animation without changing the mood or manual motion preference.

This decision partially supersedes the [reserved-placement decision](2026-09-26-rest-companion.md), not its default placement or local-only rationale. A user-selected floating position may cover conversation content or the composer. The package still makes no model calls, writes no session events, requests no external images, and provides no sound, timer, or notifications.

## Alternatives considered

**Keep the character permanently docked.** This avoids obstruction but does not satisfy user-controlled placement. Docked startup and an explicit return control preserve a non-overlapping default without forbidding movement.

## Consequences

User-controlled placement gives up a universal no-overlap guarantee. Viewport clamping keeps the character reachable but does not avoid conversation or composer content; moving or docking it clears that obstruction. Position is ephemeral and is not synchronized between browsers. It adds no independent observation requiring a runtime invariant.

## Verification

The [assembled browser scenario](../../../../apps/web/tests/companion.e2e.ts) exercises mouse and touch dragging without mood activation, a subsequent ordinary click, clamping after a phone-size resize, compact control geometry, and docking into the phone header. The [gesture specs](../../../../packages/client/ui-companion/tests/drag.client.spec.tsx) cover cancellation, capture cleanup, keyboard movement, and visible-viewport changes. Physical pen hardware remains unverified.
