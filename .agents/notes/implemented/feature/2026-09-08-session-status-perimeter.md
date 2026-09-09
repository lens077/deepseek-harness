# Agent Note: Low-motion Session status perimeters

Status: implemented

English | [中文](2026-09-08-session-status-perimeter.zh.md)

## Problem

The sidebar's compact status dots communicate state but are easy to miss when several conversations are visible. A continuously bright or fast border would solve visibility by creating another problem: persistent peripheral motion, excessive contrast, and a poor reduced-motion experience. The presentation also has to preserve the semantic distinctions already owned by the [completion reminder and pending-interaction dots](../../../../packages/client/ui-workspace/README.md#use-this-package) and by [descendant activity](2026-07-27-web-subagent-conversations.md).

## Decision

`ui-workspace` adds a decorative perimeter to grouped, flat, archived, and search Session rows. Pending interaction suppresses the perimeter. Otherwise an owning Session run takes precedence, the exact durable `sessionDigest.outcome === 'error'` value represents failure, and the process-local unviewed completion reminder represents success. Aborted, blocked, token-limited, and interrupted outcomes remain distinct and do not receive the error treatment. Activity belonging only to a descendant retains its existing dot and accessible label without claiming an own-running perimeter.

The running treatment uses one low-opacity semantic-color track and one long conic-gradient highlight rotating every eight seconds. The overlay is the ring mask and clip, and only a centered square gradient inside it rotates, so the highlight travels along the row edge without painting outside the row. Completion and error treatments are static, so terminal rows never loop or flash. The overlay is a child element because the row's pseudo-elements already own drag insertion markers. `prefers-reduced-motion: reduce` removes the rotating highlight and keeps the state-colored track.

The persisted Workspace viewing store exposes three modes through General Settings: `animated` is the default; `static` keeps the track but removes motion; `hidden` omits only the perimeter. Status dots and screen-reader labels remain in every mode. The store key moves to `dsh.workspace.view.v9` because persistence restores a whole value and an older value cannot supply the required mode field.

## Consequences

No Host state, Session event, or wire field is added. The row projection imports only the `sessionDigest` type augmentation and converts the latest outcome into one presentation boolean. The v9 persistence key starts this viewing store from defaults once for browsers that only have a v8 value; later changes persist normally.

The perimeter communicates current owner activity, an unviewed completion, or the newest failed Turn without changing click, selection, hover, drag, or status-dot behavior. Automated browser coverage exercises the default loop, reduced motion, static and hidden choices, reload persistence, the running-to-completed transition, and the absence of a perimeter on a descendant-only running owner.

## Alternatives considered

- **Animate completion and failure.** Rejected because repeated terminal motion adds distraction without communicating ongoing work.
- **Treat every non-completed Turn outcome as failure.** Rejected because abort, interruption, blocking, and token exhaustion have different meanings; only `error` owns the error presentation.
- **Reuse row pseudo-elements.** Rejected because they already draw drag insertion targets, and sharing them would couple independent states and paint order.
- **Hide status dots with the perimeter.** Rejected because the preference controls a supplemental visual treatment, not the semantic and accessible status presentation.
