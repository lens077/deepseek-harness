# Agent Note: Configurable Workspace session count

Status: implemented

## Problem

The grouped Workspace browser previously fixed every collapsed Workspace at five Session rows. The same limit wastes available height on large displays and hides too much context for users who prefer a denser sidebar.

## Decision

The Workspace view store persists `collapsedSessionCount` beside grouping and ordering preferences. The value is an integer from 5 through 20 or `auto`; five remains the default. The existing view-options menu owns the setting because it already controls how the Workspace list is presented.

Automatic sizing observes the grouped tree height and estimates a per-group row budget after group-header chrome. The result is clamped to the same 5–20 range. Explicitly expanded groups continue to show every Session regardless of this preference.

## Consequences

The setting stays browser-local viewing state and adds no Host settings schema or session event. The persisted store key advances so older stored state cannot omit the new required field. Flat-list mode ignores the preference because it has no per-Workspace collapse control.

## Verification

Run the ui-workspace component tests, its TypeScript build, and the repository `pnpm build` command.
