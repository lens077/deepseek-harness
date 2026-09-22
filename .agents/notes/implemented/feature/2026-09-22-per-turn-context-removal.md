# Agent Note: Per-turn context removal from the question panel

Status: implemented

English | [中文](2026-09-22-per-turn-context-removal.zh.md)

## Problem

A long session accumulates turns the human no longer wants the model to weigh — a wrong direction, a debugging detour, a question answered elsewhere. The only ways to shrink model history were compaction, which condenses everything older than a retained tail and chooses the range itself, and `session.fork`, which copies a prefix into a new session and throws away everything after the cut. Neither lets a reader point at question 3 and question 5 and say "the model should not see these", and the append-only log forbids deleting them.

## Decision

**Removal is a surface replacement, not a deletion.** Each contiguous group of selected turns is replaced by one `user/message` with empty `content` and a `replace` surface operation over the group's span, citing a `compaction/prune` shadow price and every shadowed node. `deriveEventMessage` projects an empty user node to no message — the same rule an empty system prompt and a usage-only assistant message already follow — so the surface keeps a node at the position while request history loses the span. No new event type, surface operation, or format version was needed; the token meter, the compaction invariant, replay, and the Client's surface fold all consume the existing protocol.

**The unit is the whole turn.** A turn's span is every current surface node whose event lies between its `turn/start` and `turn/end`, plus replacement copies (a pruned tool result) whose cited surface events all lie there; both edges must be tool-pairing balanced. Removing a single message would orphan tool calls or answers; removing a turn removes a question and everything the loop did to answer it.

**The checkpoint provenance lives in `dsh-compaction/checkpoint`.** `contextRemovalSource(removalId, turns, promptSeqs)` and `isContextRemovalSource()` sit beside the compaction checkpoint in the cordis-free leaf that Host and Client programs already share, so the Web GUI recognizes a removal without a new cross-aggregate project reference and the executor package stays Host-only.

**The executor is a host-plane service, `ctx.contextRemoval`,** in `packages/compaction/context-remove`. It runs inside `agent.runMaintenance` like `/compact`, validates every requested turn against one log scan and the current surface, then appends all groups without yielding: either every group lands or nothing changes. It refuses an open compaction bracket, a durably open turn, an unknown or unfinished turn, an already-removed turn, and a turn whose span shares a compaction summary with other history. The session controller exposes it as `session.removeTurns`, mapping refusals to `session/agent-busy` and `session/turn-remove-unavailable`.

**The question panel owns selection.** The Chat question panel gains a per-row trash entry (single) and a select mode with checkbox rows, a select-all entry, and one remove button (multi); both route to the centered confirmation dialog described in [the confirmation-dialog Agent Note](2026-09-23-context-removal-confirmation-dialog.md), which also suspends the panel's outside-press close while it stands. Rows whose turn is running, unloaded, already removed, or condensed cannot be picked, and the notice says why. After a removal the transcript keeps every row: the removed turn's rows render at reduced opacity through `data-context-removed` on the flow item, and a marker row shows where the checkpoint landed.

## Alternatives considered

**A new `{ op: 'remove' }` surface operation.** Rejected: it would extend the closed `SurfaceOp` union, the fold, every replacement consumer, and the persisted format, for a semantics the empty-node projection already expresses.

**Delete the events from the log.** Rejected: the log is append-only by contract, replay must reconstruct every request that was sent, and the human transcript must keep what the reader saw.

**Remove one message.** Rejected: a lone assistant message with a tool call, or a lone tool result, cannot leave without breaking the pairing the provider requires; the turn is the smallest unit that leaves history well-formed.

**A `context/remove` marker event with its own shadow price.** Rejected: the token meter would have to learn a third pricing event; `compaction/prune` already states the exact span price for any model-free replacement, and the checkpoint source carries the turn identity the transcript needs.

## Testing

`packages/compaction/context-remove/tests/context-remove.spec.ts` covers the executor over a detached session (single, adjacent-merged, and separate groups; the first turn's protected system head; tool pairs; a pruned tool result; every refusal class; cancellation and a failed checkpoint) and through the real loop with invariant companions, checking that the next model request drops the removed turn and that a fresh fold of the log reproduces the same history. `loader-composition.spec.ts` boots the plugin through the Loader. `session-remove-turns.host.spec.ts` covers the controller's validation and error mapping. `question-navigator.client.spec.tsx` covers single and multi-select removal, confirmation, refusal, removed-row marking, and dropped picks; `conversation-node-definitions.client.spec.ts` covers the marker node; `turn-summary.client.spec.ts` covers the removed/removable derivations; `apply-inject.client.spec.tsx` covers the remote binding.

## Consequences

- The Client's `session.removeTurns` needs `@deepseek-ai/dsh-context-remove` mounted; the web-app bundle mounts it on the host plane beside the token meter, and a deployment without it answers `gateway/internal`.
- A turn condensed by compaction is not selectable; the summary is the only unit left, and this feature does not offer it.
- Removal invalidates provider prefix cache from the first removed message onward, as any surface replacement does.
