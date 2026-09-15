---
description: "Removing selected completed turns from a session's model-visible history on request while the log and transcript keep them."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-remove

English | [中文](README.zh.md)

## Summary

`dsh-context-remove` provides `ctx.contextRemoval`, an idle-session operation that removes complete, already-answered turns from what the model sees next. A human picks the questions to drop; each contiguous group of selected turns is replaced on the surface by one empty-content checkpoint user message that projects to no wire message. The append-only session log keeps every removed event, the human transcript keeps showing them, and replay reproduces the exact model-visible history before and after the removal. The operation makes no model call.

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

Mount this package on the host plane when a client needs per-turn context removal. The Web GUI's session controller exposes it as `session.removeTurns`, which the Chat question panel uses for single and multi-select removal.

### Smallest working composition

```yaml
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-context-remove'
```

The service has no configuration. It requires `ctx.tokenMeter` to price each removed span for the shadow-price protocol and `ctx.sessions` for the durability checkpoint after the replacements land.

### What one request does

`removeTurns(agent, turns, signal)` runs inside the agent's idle maintenance phase, so it starts only while no turn is driving and later prompts wait until it settles. It resolves every requested turn to its current surface span, validates all of them, then appends the replacements without yielding: either every group lands or nothing changes. Surface-adjacent turns share one replacement. After the appends the session is flushed.

A request is refused as a whole, with a `ContextRemovalError` code, when:

| Code | Condition |
|---|---|
| `busy` | The agent is driving a turn or running maintenance, a compaction bracket is open, or the log ends inside an open turn. |
| `unavailable` | A turn is not in the session, has no `turn/end`, is already removed, shares a compaction summary with other history, or is not a tool-pairing-balanced span. |
| `cancelled` | The agent cancelled the maintenance task before the replacements landed. |
| `persistence` | The replacements landed but the durability checkpoint failed. |

### What is removed

A turn's span is every current surface node whose event lies between that turn's `turn/start` and `turn/end`, plus replacement copies (a pruned tool result) whose cited surface events all lie there. The first system-prompt node is never part of a span. Later system nodes inside a removed turn are shadowed with it; the loop's normalization restores the prompt on the next request. Steering messages admitted into the turn and injected context recorded inside it leave with it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Durable protocol

Each landed group is two adjacent events: a `compaction/prune` shadow-price event naming the exact span and its heuristic token price, then a `user/message` with empty `content`, a `replace` surface operation over the span, `sourceEventSeqs` citing the prune event and every shadowed node, and the `contextRemovalSource` provenance from `@deepseek-ai/dsh-compaction/checkpoint` (`removalId`, `turns`, `promptSeqs`). `Session.deriveEventMessage` projects an empty user node to no message, so the surface keeps a node at the position while the request history loses the span. The token meter's projection consumes the adjacent claim, so context pressure drops by the priced span.

### Span resolution

One forward log scan collects the requested turns' boundaries and the durable lock state (open turn, open compaction bracket, reset at `session/end-seed`). Each surface node is classified against a turn's range as inside, outside, or shared; a shared node is a compaction summary whose cited surface events straddle the range, which makes the turn unremovable on its own. A previous removal checkpoint counts as outside, so a removed turn reads as absent. Both span edges must pass `toolPairingBalancedBefore` / `toolPairingBalancedAfter`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `ContextRemovalExecutor` (`ctx.contextRemoval`), `ContextRemovalError`, span resolution and the two-event commit |
| [`src/types.ts`](src/types.ts) | `ContextRemovalAgentContext`, error codes, `ContextRemovalGroup`, `ContextRemovalResult` |
| — | No runtime invariant companion is published; the compaction companion validates `compaction/prune` spans and Session validates each replacement. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Compaction seam](../compaction/README.md) — owns the checkpoint provenance, tool-pairing balance, and the shadow-price protocol this package reuses.
- [Tool-result pruner](../compaction-tool-result-pruner/README.md) — the other model-free replacement producer on the same protocol.
- [Session controller](../../api/session-controller/README.md) — the Web `session.removeTurns` command over this service.
- [Token meter](../../llm/token-meter/README.md) — prices the removed span and folds the shadow price.

-----

<a id="model-experience"></a>
## Model Experience

### Removed turns

#### What the model sees

After a removal, later requests no longer contain the removed turns' `user/message`, `assistant/message`, and `tool/result` projections; the replacement checkpoint has empty `content` and projects to no wire message, so nothing marks the gap. Requests built before the removal are unchanged in the log.

#### Token effect

Each request loses the removed spans' tokens. The operation makes no model call.

#### KV Cache effect

Replacing earlier history invalidates reuse from the first removed message onward; the prefix before the earliest removed span stays eligible while its route, envelope, and preceding history remain identical.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Whole turns only** — a single message inside a turn cannot be removed; the unit is the turn because tool calls and results must stay paired.
- **Compacted turns are not selectable** — once a compaction summary condenses a turn with its neighbors, the summary is the only removable unit and this service does not offer it.
- **No undo** — the replacement is a logged surface operation like compaction; restoring a removed turn needs a new replacement producer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
