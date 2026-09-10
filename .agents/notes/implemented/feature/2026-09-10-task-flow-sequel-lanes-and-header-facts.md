# Agent Note: Task-flow sequel lanes and header facts

Status: implemented

English | [中文](2026-09-10-task-flow-sequel-lanes-and-header-facts.zh.md)

## Problem

A session with three prompts — one completed, one stopped by the user, and one re-sent verbatim and still running — drew a task-flow strip whose header read `1/3 · 用时 2小时12分 · 当前：… · 最近分支：#4 新问题 为什么不换模型？…` above lanes numbered `#2`, `#3`, `#4`. Every element misled. The progress counted `Execution` nodes, so the stopped turn stayed in the denominator forever and `1/3` matched nothing the user could see. The elapsed time ran from the first prompt to now and so included two hours of idle time around twenty-four minutes of execution. The current fact was squeezed to an ellipsis because it and the latest-branch fact shared one flex-shrink rule while the branch carried an 80-character prompt preview, and even unsqueezed it would have read `当前：执行`, the generic title of a steps node. The latest-branch fact repeated the lane drawn directly below it and named the same prompt as the current fact. Ordinals came from the timeline's turn index, so a first turn without a user prompt left `#1` missing. Every prompt sent after the previous turn closed was classified as a `fork` off the root prompt and captioned `从「…」分叉`, so a linear twenty-turn conversation drew nineteen sibling branches hanging off turn one, and the re-sent prompt looked like a sibling of the prompt it retried. The header also carried a font-size stepper and three identical chevron glyphs, with the collapse toggle sitting between the red stop button and the canvas action as if it were a stop menu.

## Decision

The lane model distinguishes three kinds by durable evidence: `main` for the first prompt, `interjection` for a prompt admitted while a loaded turn was open, and `sequel` for every later prompt. A sequel's `parentLaneId` is the previous lane on the line (the main lane or the latest sequel) and its `anchorNodeId` is that lane's last spine or terminal node, so a sequel continues the line rather than branching from the root. A sequel whose prompt text equals the previous turn lane's label after that turn ended in a terminal state records `retryOfLaneId` and is captioned `Retry of #n`. The `fork` kind and the `Forked from` caption are removed; the fallback for a prompt admitted during a turn outside the loaded window is also a sequel. Ordinals are the prompt's position among loaded prompts, gap-free from 1, so steer prompts inside an open turn number their own lane.

The three drawings follow: the rail chains the main line and its sequels as one track and hangs interjections below as branch rows; the card layout places the line on its first row, continuing each sequel after the previous lane's last column with a solid edge, and places only interjection rows under their anchor; the lane board keeps one row per lane and shows the lane kind or retry caption.

`FlowSummary` replaces `total`/`done`/`startTime`/`endTime` with lane counts by state (`done` including at-risk lanes, `running`, `stopped` for every terminal state), `activeMs` as the sum of closed turn spans, `currentLaneId` for the open turn's lane, and `latestBranchLaneId` restricted to interjections other than the current lane. The strip header and the canvas toolbar show the non-zero counts (`进行中 1 · 已完成 1 · 已中止 1`); the elapsed fact is `本轮 {span}` for the open turn while one runs and `用时 {activeMs}` otherwise; the current fact names the open lane by ordinal and a 24-character prompt clip plus the running spine node with its step count or the lane's spine progress (`当前：#4 为什么不换模型？你应该从我已经… · 执行 35 步`); the interjection fact appears only when an interjection other than the current lane exists, keeps its status outside the ellipsized text, and shrinks before the current fact, which holds a 14em minimum width.

The header layout places the collapse toggle before the title with a right/down chevron, drops the font-size stepper (the General settings row remains the only control), and makes `Stop task` the last action.

Three follow-ups came from the first acceptance screenshot. The strip folds history: `FlowGraph` takes an optional history control, and the strip passes one that folds every lane before the newest line lane (with the interjections hanging off them) into one `History n · counts` chip; clicking the chip shows the whole flow and `Hide earlier turns` folds it again. The fold state is strip-local and the canvas never folds. Captions still resolve against the complete lane table, so a retry of a hidden lane keeps naming it. A turn drawn as one steps node no longer gets a separate terminal node: the steps node carries the terminal status as its title, the step count and span as its meta, and the recorded cause as its tooltip; turns with a todo spine keep the terminal node. Cancels (`aborted`) draw in neutral tones instead of the error color, and prompt nodes are neutral in every drawing unless their lane is running, because a prompt records the question, not an outcome.

## Alternatives considered

**Keep `fork` and add `sequel` beside it.** No durable evidence distinguishes a fork from a sequel: both are prompts admitted between turns. A kind that cannot be observed would never be produced.

**Show both wall-clock and active time in the header.** Two elapsed facts compete for the space the current fact needs; the strip is about what runs now, so the open turn's span wins while running and the active sum answers "how long did this take" afterwards.

**Keep done/total over spine and agent nodes as the leading fact.** The count mixed steps nodes, todos, and agents across lanes, and terminal lanes could never complete. Spine progress stays where it is meaningful: per lane on the lane board and inside the current fact.

**Fold history inside the snapshot with a synthetic node.** A `history` node kind would have to carry a lane id, a turn, and an anchor seq it does not have, and the lane board's "prompt is always first" rule would break. Folding at the drawing over a filtered lane list keeps the model honest and lets the canvas ignore folding.

**Number lanes by turn index but include turns without prompts.** A turn without a user prompt draws nothing, so its ordinal would still point at an empty slot; positional numbering of prompts is the only sequence the user can verify against the chat.

## Consequences

`FlowLaneKind`, `FlowLane.retryOfLaneId`, and `FlowSummary` change; both drawings, the fold spec, the component spec, and the recorded Web expectations update together. The strip's `TaskFlowDockInjected` no longer carries `setFontSize`. A retry is detected only against the immediately previous turn lane, only after a terminal end, and by comparing the 80-character prompt previews the nodes carry; a re-send after a completed turn is an ordinary sequel. The card graph's first row grows with every sequel, which the canvas pan/zoom and the strip's horizontal scroll absorb; the lane board remains the compact per-prompt list for long sessions.
