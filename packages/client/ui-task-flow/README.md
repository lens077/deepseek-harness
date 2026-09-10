---
description: "Task execution flow graph for the Web GUI: a resident strip above the composer and a pan/zoom Flow view drawn from the session's prompts, todo lists, delegated agents, and turn outcomes; for users and maintainers of the task-flow experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-task-flow

English | [中文](README.zh.md)

## Summary

This package draws the task execution flow of a session in the Web GUI. When visible, a resident strip above the composer shows lane counts, elapsed time, the prompt whose turn is open, and the latest interjection, and expands into a left-to-right flow graph; the `Flow` Conversation view enlarges the same graph on a pan/zoom canvas. Both surfaces fold the durable session log only: user prompts open routes, inbox admissions classify a route as an interjection hanging off the running node or a sequel continuing the line, whole-list todo snapshots form the spine, delegated-agent tool calls fan out from the todo they served, and each `turn/end` reason decides the terminal state, so a manual stop draws as a stopped route. Three drawing variants (card graph, step rail, lane board) are selectable independently for the strip and the canvas; the strip defaults to the step rail and the canvas to the card graph.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation`, `ui-session`, `ui-settings`, and the locale plugin; the Host half registers the `ui-task-flow` settings namespace when a settings provider exists. The strip appears in the composer-context stack as soon as the session has a first prompt inside a loaded turn, and the `Flow` tab joins the Conversation view ring after `Trajectory`.

Below 768px, the composer strip is hidden unless General settings enables **Show task flow on mobile** (`ui-task-flow.mobileDock`, default `false`). The explicit Flow view remains available, and desktop strip visibility is unaffected. Host-backed scopes persist this setting in the Host document; memory-mode remote browsers use origin-local `dsh.task-flow.mobile-dock` storage and reset invalid stored values to `false`.

### Reading the graph

| Element | Meaning |
|---|---|
| Route `#n` | One user prompt, numbered from 1 in prompt order: `Main line` for the first, `Interjection` when admitted while a turn was running (hanging off the node that was running), `Follow-up` when sent after the previous turn closed (continuing the line after its last node). A follow-up that re-sends the previous prompt verbatim after that turn stopped is labelled `Retry of #n`. A steer inside an open turn draws as an interjection with only its prompt node. |
| Spine node | One item of the latest `todo/write` in that turn, in list order, with the item's first in-progress and completed times; a turn without todos or agents draws one `Execution` node covering its steps. |
| Fan-out | Delegated-agent calls (`subagent`, `subagent_fork`, `workflow`, `ralph` by default) stacked after the todo that was in progress when they were called; a failed agent marks that todo `At risk`. Clicking an agent opens its call in the Trajectory view. |
| Terminal node | Present only when the turn did not complete: `Stopped (stopped manually)` for a user cancel, other cancel causes, `Failed`, or `Interrupted` for a crash-closed turn. |
| Header | Route counts by state (`running`, `done`, `stopped`), elapsed time — the open turn's span while one runs, otherwise the sum of closed turn spans without idle time between turns — the open route's ordinal and clipped prompt with its running spine node and step count or spine progress, and the latest interjection other than the open route, with its status. The interjection fact shrinks before the current fact on narrow layouts. |

### Controls

The collapse toggle sits before the strip title. The style menu switches the strip variant; `Open in canvas` selects the `Flow` view, whose toolbar offers the same counts, elapsed time, stop, style, and `Back to chat` controls, plus zoom buttons and `Fit to view`. `Stop task` (visible while the session runs) is the last header action; it cancels the running turn and keeps the queue. Both variant choices persist in the Host settings document and also appear in General settings. `Task-flow font size` controls text in the strip and canvas independently of body text size: 11px by default, adjustable from 10px to 16px in General settings. The expanded strip's graph body scrolls internally above 160px; its header wraps on narrow layouts.

Authentication failures (`AUTH`) omit the raw provider error message from task-flow snapshots and display a localized API-key-invalid message instead. Other error messages retain their existing presentation; Session logs and model-visible data are unchanged by this display policy.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `agentToolNames` | `['subagent', 'subagent_fork', 'workflow', 'ralph']` | Tool names whose `tool/call` events draw as delegated-agent nodes. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Four Event Definitions register into the `task-flow` view target: prompts keyed by message id (`user/message` with a user source), inbox admissions keyed by seq (`agent/inbox/spliced` with inserted messages, recording the open turn from the match Location), todo snapshots keyed by seq (`todo/write`), and agent calls keyed by call id (`tool/call` for the configured names, settled by `tool/result`). The view builder keeps the current target Nodes by key and reassembles the snapshot on every publication from those Nodes and the engine's Turn timeline, so history replace, older-page prepend, and live append all produce the same result. Interjection anchoring compares the admission time against spine node spans; a sequel anchors to the last spine or terminal node of the line's previous route. The card layout is a pure function that places the main line and its sequels on one row, one column per spine node with served agents stacked in the next column, and interjection rows under their anchor; the rail chains the same line and hangs interjections below it, and the lane board lists one row per route. The strip and canvas read the snapshot through the Session-scoped `useTaskFlow` hook; the strip's expanded flag is a persisted per-session store; the canvas transform is component-local. The `Open in canvas` action uses `uiConversation.openView`, the shell-installed View opener.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the flow surface is not enough. They move from the browser drawings to the Conversation assembly and the events it folds.

- [Conversation assembly](../../../docs/subsystems/conversation.md) — the Definition, Context, Location, and view-target model this package builds on.
- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.input.dock` and `conversation.view` slots and the View opener.
- [tool-todo](../../todo/tool-todo/README.md) — the `todo/write` snapshots that form the spine.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None. The package reads the session log and issues the same cancel the composer's stop button issues; it adds no prompt sections, tools, or messages.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current task-flow surface. They are current package constraints, not a task backlog.

- **Loaded window only** — a prompt whose `turn/start` lies outside the loaded history pages opens no route until an older page is loaded; the canvas does not trigger paging.
- **Chat navigation** — clicking a prompt or todo node does not scroll the Chat view; only agent nodes navigate, to the Trajectory inspector.
- **Workflow phases** — `tool-workflow/*` events are not folded; a workflow run draws as one agent node.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The registrations are disposed with the plugin fiber, proven by the browser-plugin spec; the package owns no cross-plugin mutable state beyond the settings-backed style policy.
