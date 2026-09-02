# Agent Note: Cross-workspace finished-session digest

Status: implemented

English | [中文](2026-09-01-cross-workspace-finished-session-digest.zh.md)

## Problem

A user can run many agent conversations across several Workspaces, but the session tree only answers where those conversations are and whether they are active. Finding completed work requires opening rows one by one, and the transient unviewed-completion marker disappears after navigation or process restart. The useful summary already exists in durable conversation events: the latest direct human question, the assistant's closing reply, and the turn outcome.

## Decision

The Web application ships a cross-workspace digest as a whole center-column surface. A `sidebar.nav.entry` row between New Session and the Workspace browser toggles a `center.overlay` entry without replacing the resident conversation component. The panel lays finished sessions out left to right in a responsive grid, groups them by Workspace or recency, and keeps running work out of the grid while reporting its count.

Each card represents one visible top-level Session. Its upper half is the newest `user/message` whose `source.kind` is `user`; injected context, compaction checkpoints, and continuation messages do not qualify. Its lower half is the newest non-empty `assistant/message` after that question. A `turn/end` reason closes the card: `completed` gives the requested green top edge, while every other terminal reason remains visible with a failure edge. Blank Sessions and `origin: 'subagent'` rows are excluded so one delegated task is not counted again beside its parent.

`@deepseek-ai/dsh-session-digest` registers the `sessionDigest` unit in the existing [Session projection system](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md). The unit folds committed log events, resets its reply and outcome when a new direct question lands, and stores bounded question and answer previews plus truncation flags. The standard session-list projection block carries the value for attached and cold Sessions; the persisted projection cache supplies cold rows without loading or attaching every log. The client adds no interception store, send listener, polling path, or model call.

`@deepseek-ai/dsh-client-ui-digest` reads `SessionSummary.projectionValues.sessionDigest` through the existing global session hook. The sidebar entry and panel share one declared viewing store that owns only open/closed and grouping state. Each card displays its complete bounded previews and exposes a separate Open session action. The action closes the panel and opens its Session, so reading content never navigates accidentally and the requested result is visible in the center column. A truncated reply points to that path rather than attaching every listed Session to retrieve full history.

## Alternatives considered

**Capture prompts and replies in a browser-global store.** Rejected because a send-time observer publishes before Host commit, misses other clients and pre-existing Sessions, and loses authority across refresh. Session events already provide committed, replayable messages.

**Generate an LLM summary after each turn.** Rejected because the durable assistant message is already available verbatim. An auxiliary request would add latency, cost, failure modes, and a second interpretation of the result without being necessary for this navigation surface.

**Carry complete replies in every session-list projection value.** Rejected because every list row carries every client-visible projection key. Bounded previews keep list payloads proportional to the number of Sessions; full history stays behind explicit Session navigation.

**Reuse the transient `completed` list bit.** Rejected because it means “finished while unselected and not yet opened,” not durable task completion. A card derives completion from the logged `turn/end`, so viewing it does not remove it.

**Render the digest inside the sidebar.** Rejected because the sidebar owns navigation at a 264–420 px width. The sidebar contributes only the entry; the center column owns the content density and left-to-right card layout.

## Consequences

The panel reconstructs completed work across Workspaces without an additional wire protocol, model request, or per-Session attachment. Refresh, another browser client, and cold persisted Sessions converge through the same projection and cache machinery.

One card describes the newest direct question in one Session, not every task ever discussed there. `completed` classifies the turn lifecycle rather than proving that the real-world task succeeded. Long answers are previews, and all finished Sessions accumulate until the product adds an explicit time or filter policy. A cold projection cache written before `sessionDigest` has no row for the unit; that Session appears after a cold projection read or an open-and-checkpoint cycle rather than forcing the zero-I/O list path to scan old logs.

The digest adds two reusable layout seats. `sidebar.nav.entry` is for whole-surface navigation below New Session; `center.overlay` is for center-column surfaces that must leave sidebar and details ownership intact. Both remain slot declarations rather than feature-specific imports in layout packages.

## Verification

The host suite pins direct-user filtering, multi-step last-answer selection, reset-on-new-question, terminal outcomes, bounded previews, missing-unit behavior, and registration disposal. Client suites pin selection and grouping, running-count-only behavior, card navigation, truncation messaging, store interaction, locale parity, and disposal of both slot registrations. The full client suite covers the new layout and sidebar declarations together with the stylesheet elevation rules.

## Related

- [Session projection state and client views](../architecture/2026-08-19-session-projection-state-and-client-views.md) owns the fold-state/client-value split used by `sessionDigest`.
- [Web background-job display](2026-08-08-web-background-job-display.md) owns process-scoped `ctx.jobs` visibility; its records are not durable Session outcomes.
- [Task Surface](../../proposed/feature/2026-08-04-task-surface.md) remains the proposal for a declarative interaction inside one Session, not a cross-Session digest.
