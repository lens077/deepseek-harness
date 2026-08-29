# Agent Note: Conversation question navigation

Status: implemented

## Problem

Long conversations require repeated manual scrolling to revisit user questions, and the transcript's paged history means a visible-only index can omit earlier questions.

## Decision

The Chat view derives a question index from finalized `user` Chat Nodes and keeps navigation presentation local to the conversation plugin. A sticky control stack shares the existing composer-height anchor with the back-to-bottom button. It exposes adjacent navigation, a compact current-question marker, and a searchable full list.

The current question is the last user row at or above the transcript reading edge. A jump aligns the target row to the top, respects reduced-motion preferences, and applies a two-second visual highlight. Moving before the loaded head requests the next older page before resolving the target; opening the full list continues to expose the existing history paging action rather than introducing a second session data path.

Question-navigation shortcuts use the conversation settings namespace. Platform defaults use Command with arrow keys on macOS and Control elsewhere. The General Settings row records arbitrary non-modifier keys, requires explicit confirmation for unmodified single keys, rejects a modifier alone, prevents duplicate previous/next bindings, and offers three focus policies. The default policy suppresses shortcuts in form controls and editable regions.

## Consequences

The feature adds no session events and does not change model-visible history. It depends only on the Chat Node projection and the existing `loadOlder` operation, so replay and paging keep one authority. The compact index deliberately shows at most seven nearby entries; the expanded list remains the complete loaded index and includes local text filtering.

## Verification

Run the ui-conversation TypeScript build, the focused Chat view component suite, the Web frontend build, and a browser smoke against a separately started `dsh web` instance.
