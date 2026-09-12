# Agent Note: Conversation question navigation

Status: implemented

English | [中文](2026-08-28-question-navigation.zh.md)

## Problem

Long conversations require repeated manual scrolling to revisit user questions, and the transcript's paged history means a visible-only index can omit earlier questions.

## Decision

The Chat view derives a question index from finalized `user` Chat Nodes and keeps navigation presentation local to the conversation plugin. A sticky control stack shares the existing composer-height anchor with the back-to-bottom button. It exposes adjacent navigation, a compact current-question marker, and a searchable full list.

The current question is the last user row at or above the transcript reading edge. A jump aligns the target row to the top, respects reduced-motion preferences, and applies a two-second visual highlight. Moving before the loaded head requests the next older page before resolving the target; opening the full list continues to expose the existing history paging action rather than introducing a second session data path.

The searchable list named here searched only the loaded window, so it answered "no match" for questions held in earlier pages. [Honest question search](../feature/2026-09-14-honest-question-search.md) supersedes that half of this decision: search is a whole-session host query with its own standing entry, and the paging action it relied on is gone. The navigation, current-question, and shortcut decisions below are unaffected.

Question-navigation shortcuts use the conversation settings namespace. Platform defaults use Command with arrow keys on macOS and Control elsewhere. The General Settings row records arbitrary non-modifier keys, requires explicit confirmation for unmodified single keys, rejects a modifier alone, prevents duplicate previous/next bindings, and offers three focus policies. The default policy suppresses shortcuts in form controls and editable regions.

## Verification

Run the ui-conversation TypeScript build, the focused Chat view component suite, the Web frontend build, and a browser smoke against a separately started `dsh web` instance.

## Alternatives considered

**Index only the rendered rows** — rejected because the transcript pages its history, so an index built from what is currently mounted silently omits the earliest questions. That is the precise failure the feature exists to remove, and it would return whenever a session grew past one page.

**Load the full question list through its own session query** — rejected because it would stand a second data path beside the existing `loadOlder` paging. The expanded list reuses that action instead, so replay, paging, and the index keep one authority.

**Give the control stack its own viewport anchor** — rejected because a second independent anchor drifts against the composer as it grows or wraps. Sharing the back-to-bottom button's composer-height anchor keeps one positioning rule for both controls.

**Bind the shortcuts on the navigation control per session** — rejected because a key binding is a global interaction preference, not per-conversation state. Keeping it in the conversation settings namespace makes one binding apply to every session and keeps the recorder in General Settings beside the other input preferences.

## Consequences

The feature adds no session events and does not change model-visible history. It depends only on the Chat Node projection and the existing `loadOlder` operation, so replay and paging keep one authority. The compact index deliberately shows at most seven nearby entries; the expanded list remains the complete loaded index and includes local text filtering.
