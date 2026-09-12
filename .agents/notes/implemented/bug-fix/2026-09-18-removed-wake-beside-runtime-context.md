# Agent Note: a removed waking message spends no model call beside runtime context

Status: implemented

English | [中文](2026-09-18-removed-wake-beside-runtime-context.zh.md)

## Problem

The turn's empty-step guard decides whether a step spends a model call by looking at the step's message list. That list is the claimed inbox messages plus, when any context section is registered, the runtime-context snapshot the system prompt contributes. With a section registered — the sandbox policy registers one in every deployment that mounts it — a waking message removed before its claim left an empty claim but a one-message step, and the turn called the model with nothing but the snapshot. The ACP harness exposed it the moment it composed the sandbox policy in for the additional-directories capability: `prompt` for a removed message failed with an exhausted mock script instead of settling as cancelled.

## Decision

The snapshot rides a claimed message and never stands in for one: `preStep` appends the runtime context only when the claim produced at least one message, so the step's emptiness is what the guard reads, and the existing rule — "a removed waking message owns the turn boundary but spends no model call" — holds whether or not a context section exists. Nothing changes for a non-empty claim; the snapshot still follows the claimed messages in the same step.

## Alternatives considered

**Make the guard test the claim instead of the step's messages.** Rejected: the guard also serves an `agent/pre-step` listener that rewrites an entered step to empty, and it must keep reading the decision it is given. Keeping the snapshot out of an empty step fixes both the guard's input and the request the model would have seen.

**Leave the ACP harness without the sandbox policy.** Rejected: the bridge injects `sandboxPolicy` for `session/new` directory validation, so the harness must compose it; the test was reporting a real loop defect, not a fixture gap.

## Consequences

A turn whose only candidate content is a runtime-context snapshot closes as `completed` with no step, no `user/message`, and no request, as the removed-wake case already did without a section. The loop unit suite pins this with a registered context section; the ACP cancel-before-claim test passes with the policy composed in.

## Related

- [Additional workspace directories](../feature/2026-08-18-session-additional-directories.md) — the capability whose ACP harness surfaced the defect.
