# Agent Note: Configurable Workspace session count

Status: implemented

English | [中文](2026-08-28-workspace-session-count.zh.md)

## Problem

The grouped Workspace browser previously fixed every collapsed Workspace at five Session rows. The same limit wastes available height on large displays and hides too much context for users who prefer a denser sidebar.

## Decision

The Workspace view store persists `collapsedSessionCount` beside grouping and ordering preferences. The value is an integer from 5 through 20 or `auto`; five remains the default. Two surfaces write it: the existing view-options menu, which already controls how the Workspace list is presented, and a General Settings row for users who look for preferences there. Both call the same store action, so neither becomes a second source of truth.

Automatic sizing observes the grouped tree height and estimates a per-group row budget after group-header chrome. The result is clamped to the same 5–20 range. Explicitly expanded groups continue to show every Session regardless of this preference.

## Verification

Run the ui-workspace component tests, its TypeScript build, and the repository `pnpm build` command.

## Alternatives considered

**Store the count as a Host setting** — rejected because it is viewing state, like the grouping and ordering preferences it sits beside. A Host setting would add a settings schema and a cross-client sync path for a value that legitimately differs between a laptop and an external display.

**Offer only automatic sizing** — rejected because an observed row budget changes as the window resizes, and a user who wants a predictable sidebar cannot pin it. Explicit integers stay the default and `auto` is the opt-in.

**Offer only fixed integers** — rejected because the fixed default is exactly the complaint: on a tall display any single number is either wasteful or cramped. Keeping `auto` alongside the integers covers the case where the right number is whatever fits.

## Consequences

The setting stays browser-local viewing state and adds no Host settings schema or session event. The persisted store key advances so older stored state cannot omit the new required field. Flat-list mode ignores the preference because it has no per-Workspace collapse control.
