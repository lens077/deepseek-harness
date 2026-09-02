# Agent Note: The question rail reduced to stepping

Status: implemented

English | [中文](2026-09-02-question-rail-reduced-to-stepping.zh.md)

## Problem

The transcript's right rail carried four question surfaces, and three of them drew a list of the same questions.

The tick strip rendered seven ticks that unfolded on hover into `.questionDetail` labels — one absolutely positioned overlay per tick. Siblings share a stacking area, so two expanded labels rendered on top of each other, and the rule carried `transition-delay: 2s`, forcing a two-second dwell before any text appeared. Hovering the rail on the way to the arrows therefore produced a delayed, overlapping list drawn over the text the reader was reading.

The strip was also the only way to open the question panel, which listed the same questions again with timestamps and a filter box. Compact mode's toggle folded each settled turn to one row — question, outcome, clock, file count — which is the panel's row content relocated into the transcript. Two controls in one rail produced two different foldings of one question index, and the reader had to work out which one they were in.

## Decision

Reduce the rail to stepping: previous and next. Everything that redrew the question list is removed.

`QuestionNavigator` keeps only the two arrows and returns null below two questions, where there is nowhere to step. The tick strip, the panel, its filter box, and the `loadAll` button go together, because the strip was the panel's only opener: keeping the panel while deleting its opener would leave it unreachable, and keeping the strip to reach it would keep the defect this change exists to remove.

Compact mode goes whole rather than losing its entry. Deleting only the toggle would strand `compact`, `unfolded`, the fold pass over `turnGroups`, and `CollapsedTurnRow` with no consumer, which `packages/AGENTS.md` forbids. The toggle, both pieces of state, the fold pass, the folded row, its stylesheet rules, and the `chat.compact.*` and dead `chat.questions.*` copy in both locales are all removed.

`buildTurnGroups` stays: folding was one consumer, not its purpose. The flow still walks turn groups to place recap rows and node seats, and the sticky question bar and turn recap — which state what the reader is looking at rather than redrawing the index — are untouched.

## Alternatives considered

**Repair the overlay instead of deleting the strip.** One overlay tracking the hovered tick fixes the overlap, and an in-flow label per row fixes it structurally. Both were rejected here because they invest in a surface whose content the panel already carried better; the reader asked for the duplicate list to stop appearing, not to appear more correctly.

**Keep the panel and give it a standing entry button.** Rejected for this change as scope the request did not ask for: it adds a control to a rail the reader wants quieter. It remains the obvious way to bring question search back if it is wanted, and nothing here prevents it.

**Keep compact mode and delete only the strip.** Coherent — folding and a rail list answer different questions — and it was the first instruction before the request widened. Recorded because a future request to fold turns would be reintroducing this rather than reverting the decision.

**Hide the toggle but keep the folding code for later.** Rejected: code with no reachable consumer is exercised by no test and trusted by no reader. Git history is the honest place for it.

## Verification

`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` loses its `compact mode` block wholesale; it described only removed behavior, and the repo's testing convention deletes obsolete behavior with its tests rather than adapting them. The package's remaining 30 files and 513 cases pass, and `tsc -b packages/client/ui-conversation/tsconfig.json` is clean.

`tsc -b tsconfig.client.json` reports one failure in `packages/client/ui-session-files/tests/tree-files.client.spec.ts` (a fixture missing the new `byTurn` field). That belongs to concurrent uncommitted work in this tree and is not touched here.

## Consequences

The rail no longer draws anything over the transcript, and its controls each do one thing. There is no longer a transcript mode in which turns are rows, so what the reader sees does not depend on a toggle they may not remember setting.

Question search is gone with the panel. The reader keeps the arrows, the shortcut bindings, and the sticky bar; finding a question by text is no longer possible from this rail. That is a deliberate reduction, not an oversight, and it is the item to revisit first if the rail is rebuilt.

No session events change and nothing model-visible moves: every removed surface was derived presentation over the Chat projection, so no log, wire format, or replay path is affected.
