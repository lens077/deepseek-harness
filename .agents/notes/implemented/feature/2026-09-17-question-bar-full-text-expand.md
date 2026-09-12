# Agent Note: The question bar expands its full text

Status: implemented

English | [中文](2026-09-17-question-bar-full-text-expand.zh.md)

> Extends the sticky question bar of [question-level session surfaces](2026-09-02-question-level-session-surfaces.md) and the preference of [conversation question navigation](../architecture/2026-08-28-question-navigation.md). Neither decision changes; this note records the expand toggle and its placement preference.

## Problem

The sticky question bar keeps the current question to one line and ellipsizes the rest. A long, structured question — the kind that lists numbered steps — is unreadable there: the only way to the full text was the native `title` tooltip, which is delayed, unstyled, cannot be scrolled, and disappears the moment the pointer moves. Jumping back to the question loses the reader's place in the answer, which is the position the bar exists to preserve.

## Decision

The bar gets one expand toggle that opens the full question in a panel below the pill, and the toggle's side is a preference.

### The panel hangs inside the dock

`QuestionBar` holds an `expanded` state and renders the panel as a child of its own absolutely positioned box, `top: calc(100% + 6px)`, spanning the pill's width. It therefore inherits the bar's centering and costs the flow no height: the dock stays zero-height, and the view's follow, prepend-anchoring, and paging logic, which measure `scrollHeight`, are untouched. The panel caps at `min(50vh, 420px)` and scrolls inside, so a very long question never covers the transcript. Text renders `pre-wrap` so the question's own line structure survives.

The panel is a transient reading aid, not a mode. Escape and a pointer press outside the bar close it; `ChatView` keys the bar by question so moving on to another question's answer unmounts the expanded state; jumping to the question unmounts the bar entirely. The toggle carries `aria-expanded` and `aria-controls` to the panel and swaps its label between expand and collapse.

### The side is a field of the question-navigation preference

`QuestionNavigationSettings` gains `expandButtonSide: 'left' | 'right'`, default `right`, validated by the same schema as the shortcuts. On the right the toggle is the pill's trailing element after the outcome and clock, which is where a "more" affordance is read from left to right; on the left it precedes the ordinal, which the request named explicitly. `QuestionShortcutRow` offers the two as a radio group beside the focus policy, and `reset` restores `right`.

The bar and the shortcut effect in `ChatView` now read the preference through one bound hook: `ChatViewInjected` declares `hooks: { questionNavigation }` instead of a snapshot-reading callback. A settings change therefore re-renders the bar at once; the earlier callback read a snapshot per render and would have shown the old side until the next state change.

## Alternatives considered

**Grow the pill to several lines instead of adding a panel.** Rejected because the bar is a fixed 30px pill whose height every other measurement in the dock assumes, and a multi-line pill covers exactly the answer text the reader is inside.

**Open the full text in the existing `Modal` primitive.** Rejected because a modal takes focus and dims the transcript; the reader wants to glance at the question and continue, not switch contexts.

**A separate `questionBar` settings section.** Rejected because the placement is one more question-navigation preference and belongs beside the shortcuts and focus policy it ships with; a new namespace field would need its own policy class, host key, and reset path for one boolean-sized choice.

**Keep the `questionNavigation()` callback and add a second `hooks` entry only for the side.** Rejected as two channels for one fact; the callback was already the stale-read path the client rules warn about.

## Verification

`chat-view.client.spec.tsx` gains two cases: expand shows the exact text, `aria-expanded`/`aria-controls` bind, Escape and an outside press collapse while an inside press does not; and the toggle is the last child by default, then the first child once the preference store publishes `left`, without a scroll or a question change. `question-shortcut-row.client.spec.tsx` covers the radio group: right by default, left writes the whole preference, reset returns to right. `submission-policy.client.spec.ts` literals carry the new field. The ui-conversation TypeScript project builds clean and the focused suites pass.

## Consequences

Product-visible: a chevron at the end of the question bar, a panel on click, and a new radio group in General Settings. No session event, wire operation, or model-visible input changes; the preference lives in the existing `ui-conversation` settings namespace.
