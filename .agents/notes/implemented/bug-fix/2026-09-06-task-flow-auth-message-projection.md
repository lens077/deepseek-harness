# Agent Note: Authentication-safe task-flow projection

Status: implemented

English | [中文](2026-09-06-task-flow-auth-message-projection.zh.md)

## Problem

Provider authentication errors can echo credential fragments. A task-flow terminal node that copies the provider message can expose those fragments through the composer strip or Flow view even when other conversation renderers display safe authentication text.

## Decision

The [task-flow projection](../../../../packages/client/ui-task-flow/src/client/flow-model.ts) omits the raw message when a terminal error has code `AUTH`. The node retains an explicit `failureCode`, and the shared formatter renders a localized API-key-invalid label for that code. Other error messages retain their existing behavior.

This extends the display-safe authentication policy described by [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.md) to task-flow consumers. It does not modify Session logs, provider diagnostics, or model-visible data.

## Alternatives considered

**Mask the message only during rendering.** Rejected because the raw message would remain in `FlowSnapshot`, available to every consumer and future rendering variant.

**Use a sentinel string in the detail field.** Rejected because an authentication sentinel can collide with a verbatim message from another error. The separate failure code preserves the distinction.

## Consequences

Task-flow consumers receive no raw authentication message in the terminal node, while users still see the failure category and an actionable localized label. This is an `AUTH`-specific projection rule, not a general sanitizer for all errors or log contents.

## Verification

The focused model regression asserts that authentication messages are absent from the task-flow snapshot. The assembled Web AUTH scenario retains its credential-fragment absence assertion rather than accepting provider text as expected output.
