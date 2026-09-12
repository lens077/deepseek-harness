# Agent Note: Web task execution flow graph

Status: implemented

English | [中文](2026-09-06-web-task-flow-graph.zh.md)

## Problem

A long task in the Web GUI is visible only as a scrolling transcript. A user who leaves the page and returns has to scroll to find what the agent planned, which delegated agents ran in parallel, where a mid-task question was inserted, and whether the run finished or was stopped. The reference design is a left-to-right flow graph: the task on the left, planned steps and parallel roles in the middle, a stop control, and an enlarge action. Three constraints shaped the design: the graph must be reachable without paging through history, it must be a pure projection of the session log so replay and live append agree, and a manual stop must appear on the graph without a new hook or session event.

## Decision

[`@deepseek-ai/dsh-client-ui-task-flow`](../../../../packages/client/ui-task-flow/README.md) draws the flow twice from one snapshot: a resident strip registered into `conversation.input.dock` (always visible above the composer, collapsible per Session) and a `Flow` tab registered into `conversation.view` with a pan/zoom canvas. Three drawings (`cards`, `rail`, `lanes`) are selectable independently for the strip and the canvas; the strip defaults to `rail` and the canvas to `cards`. The choice persists in the `ui-task-flow` settings namespace and is editable from the strip header, the canvas toolbar, and two General settings rows.

The snapshot is assembled by the `task-flow` Conversation view target from four Event Definitions and the engine's Turn timeline:

| Durable evidence | Contribution |
|---|---|
| `user/message` with a user source | Opens one lane per turn; a second user message inside an open turn is a steer and draws as an interjection with only its prompt node. |
| `agent/inbox/spliced` with inserted messages | The match Location records whether a turn was open at admission. A prompt admitted during turn N becomes an interjection anchored to the spine node of turn N that was open at that time; a prompt admitted between turns becomes a fork off the root prompt. |
| `todo/write` | The latest write in the turn forms the spine; earlier writes in the same turn supply each item's first in-progress and completed times. |
| `tool/call` for the configured agent tool names, settled by `tool/result` | One agent node per call, fanned out from the todo that was in progress when it was called; an error result marks the todo at risk. |
| `turn/end` | `completed` closes the lane; `aborted` (with its `AgentCancelCause`), `error`, `blocked`, `max-tokens`, and the crash-closer `interrupted` add a terminal node and a lane status. |

A turn with neither todos nor agent calls draws one `Execution` node covering its steps. The Web layer writes nothing to the session log.

Stopping reuses the composer's cancel path: the strip and canvas call the scoped `conversation.cancel()`, which reaches `session-controller.cancel` and `agent.cancel({ kind: 'user' }, { keepInbox: true })`; the resulting `turn/end` reason is the only stop signal the graph consumes. The Claude Code `Stop` hook bridge does not fire on a user cancel because the loop checks the abort signal before dispatching `agent/turn-stopping`, so no hook point was added.

`ui-conversation` gains `UiConversation.bindViewOpener` and `UiConversation.openView(sessionId, view, focus?)`: the shell installs the opener when its Session body mounts and releases it with the Session Controller binding scope, so an entry outside the shell such as the strip can select the `Flow` tab or open an agent call in `Trajectory`.

## Alternatives considered

**Inline card in the transcript.** Matches the reference screenshot but requires scrolling to find; the user rejected any placement that needs paging. The strip above the composer is reachable in every scroll position.

**A modal overlay for the enlarged canvas.** Avoids the View opener API but adds a second overlay lifecycle. The View ring already hosts `Trajectory`; a `Flow` tab reuses its selection, persistence, and tab UI, and the opener API is small.

**Todo-only or agent-only data source.** Todo-only leaves short tasks and delegated roles invisible; agent-only leaves ordinary tasks empty. The hybrid keeps the todo spine as the readable plan and draws agents as fan-out under the item they served, with a per-turn fallback so no prompt is empty.

**A dedicated `flow/abort` session event or a cancel-time Cordis hook.** Both duplicate a fact the loop already records in `turn/end`, and a presentation-only event would violate the rule that nothing that is only how-to-draw enters the log.

**One global drawing variant.** The user asked for independent strip and canvas choices; the compact rail suits the strip while the card graph suits the large canvas, so both persist separately.

## Consequences

The graph is reconstructible from any loaded window: replace, older-page prepend, and live append produce the same snapshot, which the fold spec pins through the real assembler. A prompt whose `turn/start` lies outside the loaded pages opens no lane until that page loads. Agent nodes navigate to the Trajectory inspector; prompt and todo nodes do not scroll the Chat view because Chat exposes no focus request. `tool-workflow/*` phase events are not folded. Every client spec that constructs the full `SessionStandardProps` now stubs `useTaskFlow`, the cost of a Session-scoped standard hook.
