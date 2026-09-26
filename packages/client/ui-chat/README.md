---
description: "Browser Chat target that renders Session conversation nodes, historical images, actions, localization, and scroll state."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-chat

English | [中文](README.zh.md)

## Summary

Use this package to render a browser chat from recorded Session conversations, including historical images, localized actions, and restored scroll position. Compact display folds completed-turn process rows while keeping the final answer and independently useful context visible; packed historical Assistant runs remain collapsed. Local transcript and steering submissions appear immediately, remain in their original surface, and disappear atomically when authoritative Session records arrive, while queued submissions stay outside Chat. The package does not assemble or modify model requests.

## Table of Contents

- [System prompt row](#system-prompt-row)
- [Turn token usage](#turn-token-usage)
- [Session usage and cost](#session-usage-and-cost)
- [Question navigation](#question-navigation)
- [Turn Process Folding](#turn-process-folding)
- [Scroll ownership](#scroll-ownership)
- [Reply exposure](#reply-exposure)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="system-prompt-row"></a>
## System prompt row

Each nonempty appended `system/message` owns a collapsed prompt row, including a complete prompt at the start of a headerless window; the same-step header does not duplicate it. Chat also shows a collapsed `System prompt` row for a non-empty initial request, explicit message-series start, or `system/message` surface node replacement whose text differs, reading the last nonempty surviving system node in surface order at the `request/header`; a non-initial request whose preceding header is outside the loaded history window also shows one. A resume repeats the row even when its system text is unchanged, including after pagination supplies the preceding header and system node; same-series config-only or tool-only changes, tool steps, and retries create no repetition, and a `system/message` event is never rendered as a transcript message. The row appears before that request's user messages, matching the provider envelope, and expands to the exact model-visible text with its original line breaks. A request whose system node is empty or outside the loaded window creates no row until the page holding the node arrives.

-----

<a id="turn-token-usage"></a>
## Turn token usage

A completed Turn shows an expandable usage row only when the loaded window includes `turn/start` and every started model attempt reports safe, exact usage. The row omits unavailable optional buckets. Incomplete or contradictory accounting hides the complete disclosure instead of presenting a partial total.

-----

<a id="session-usage-and-cost"></a>
## Session usage and cost

The composer usage pill prefers the Host `usageLedger` projection: observed token usage first, followed by cache hit and input per reporting step. It opens a right-side drawer with `This session`, `Session tree`, and `All sessions` scopes. The tree follows subagent-only parent edges; ordinary forks remain outside it. Aggregation deduplicates durable Session ids and counts only their own requests, not inherited histories. The existing time pill and per-Turn usage dialog remain separate.

The drawer shows reported prompt/output buckets, reasoning as an output subset, route and tool details, timing, scheduled retries, and prefix changes. Missing ledgers, incomplete reports, unpriced routes, or mixed currencies hide complete costs and budget evaluation; cold snapshots are explicitly diagnostic rather than provider invoices. The selected session's configured soft budgets and sample-gated waste thresholds apply to each scope. Without a selected session or its ledger, the drawer does not infer governance policy from other sessions. These reminders never stop, downgrade, or reroute agents. The [session-stats README](../../session/session-stats/README.md) owns configuration and accounting limits.

Opening the drawer focuses its close button and makes the application background inert. Tab stays within the drawer; closing restores the trigger. The drawer fills narrow screens and respects safe-area insets. If `usageLedger` is absent, the pill falls back to the existing `tokenUsage` dialog without inferring monetary cost.

The optional [companion usage entry](../ui-companion/README.md#use-this-package) opens a compact, non-modal preview of **Today**, **This week**, or **This month** across discovered session-list projections. It shows tokens, reporting requests, and estimated cost without creating or selecting a session. Weeks start Monday; ranges use the Host calendar's timezone, end today, and exclude future dates. They never infer request dates from `session.updatedAt` or cumulative totals. **View details** opens the existing drawer at All sessions; session and tree scopes still require a selection.

Calendar snapshots are deduplicated by Session id, with the current live projection taking precedence. Missing calendars, mismatched timezones, and pending discovery are disclosed; when no usable calendar exists, headline values show an em dash rather than fabricated zero. Partial known traffic remains visible with a warning, but incomplete or unreported usage, unpriced requests, mixed currencies, or missing snapshots suppress estimated cost. The preview displays its date range and timezone and samples time once per minute only while mounted.

<details>
<summary>Companion integration — click to expand</summary>

The [private adapter](src/client/chat/CompanionUsage.tsx) registers through `ctx.slots.inject('companion.usage.panel', ...)`, so its contribution follows the companion's declaration lifetime. It selects the [calendar preview](src/client/chat/UsagePreview.tsx) or `UsageLedgerDrawer`; the [period rollup](src/client/chat/usage-period.ts) reads dated snapshots without a backend totals query or history backfill. Chat's companion dependency is type-only and development-only, with no runtime import. Preview and drawer mount only while opened. The main Chat usage drawer and token fallback retain their existing behavior. The [calendar-usage Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-companion-calendar-usage.md) records the decision and verification owners.

</details>

-----

<a id="question-navigation"></a>
## Question navigation

The question rail searches the complete Host index, loads the remaining Session history on request, and steps through loaded questions. A search result outside the current window calls `loadThrough(seq)` before landing at the transcript reading line. Once a question row scrolls above the viewport, a sticky bar names that question and the Turn outcome, elapsed time, and changed-file totals available for it. A completed Turn that spans at least four Chat rows restates its opening question immediately before the Turn tail. The optional `chatReveal` service accepts the same Session id and question seq from cross-Session surfaces; it holds a request until that Session's Chat store mounts, then uses the same loader and landing path. File clicks — produced-file chips, inline mentions, tool-row paths — go to the optional `chatFileOpener` service when one is provided and `active()` (the composed [`ui-open-in-app`](../ui-open-in-app/README.md) routes them to the user's chosen desktop application), passing the absolute Host path; otherwise Chat opens the file in the right Sidebar's text preview at the requested line. An opener rejection is the click's failure and its message is what the open-failure dialog shows. Shortcut and focus policy are supplied by `ui-conversation` settings. The floating control column sits above the composer on the transcript's right edge, and the turn rail stands in the free column above it: the rail shows every known Turn at a fixed 10px pitch, growing to whatever height that free column allows and scrolling the remainder inside itself. Wheel scrolling reaches the rail directly, and a flat paging entry appears at whichever rail end can still scroll, so a session too long to show at once still says where the ladder continues. Settings → General sets the control column's edge length in pixels (26–58, default 34); the rail width, tick geometry, and the transcript's trailing gutter follow it, so enlarging the controls never lets transcript content run underneath them. The leading gutter is its own setting (0–60px in steps of five, default 5), because nothing floats on that side. The same page places the rail: by default it shares the controls' column and ends one gap above the search control, so the newest Turn's tick stands over it and the ladder rests at its newest end. A rail given its own column instead sits left of the controls, may use the whole band, and starts from its top, centre, or bottom; the transcript reserves the second column's width for it.

On phones, floating search and navigation controls have a minimum 44px touch target. Question history opens within the space between the phone header and bottom navigation rather than beside the control column; its list scrolls independently. Search text stays at least 16px, row removal remains visible without hover, and **Close** returns focus to the search entry. Selecting a question closes the phone panel to reveal its destination; desktop keeps the list open. Short phone viewports arrange the floating controls horizontally. Opening the panel does not load earlier history or change the search scope.

-----

<a id="turn-process-folding"></a>
## Turn Process Folding

Settings → General exposes a persisted `Normal` / `Compact` conversation-display preference in the `ui-chat` namespace; `Compact` is the default. Normal leaves process rows visible and renders no Turn-process control. In Compact mode, the System prompt remains independently visible before the opening User throughout the Turn. Context injection, reasoning, Assistant material, Tool rows, and Retry rows remain expanded while a Turn is open. At `turn/end`, its latest Step becomes the final-answer boundary only when it contains non-blank text, an image, or an unknown visible block—and no Tool-call block; preceding Context injection, reasoning, earlier Assistant material, Tool rows, and Retry rows then collapse by default. The control reports Turn-wide durable counts for non-subagent Tool calls, reply-bearing Assistant messages before the final answer, and subagent delegation calls; zero-valued segments are omitted, the Tool and subagent figures are mutually exclusive, and neither System prompt nor Context injection contributes a count. When all three counts are zero, the process still folds and the control reads `Thought for a while`. A full-width divider below the summary separates it from the answer or expanded process rows. User and steering messages, System prompt, error, max-token, and turn-tail rows stay outside, and a closed Turn with no final answer keeps all process evidence visible. A newly available process control is inserted without changing the relative order of existing rows: opening human input precedes the control and process rows from their first projection, while System prompt remains above that input. While older history remains available through Load earlier, process controls stay absent and no members are hidden; once history is complete, every eligible closed Turn uses the collapsed default immediately. Stable Chat Node Seats keep every renderer mounted, hidden members add no flow spacing, and a closed control sits 8px above its answer only when no independent input intervenes. Completion collapse does not depend on tail-follow position, so a reader above the tail may see the transcript reflow. An automatic collapse that would hide keyboard focus keeps the group open and leaves focus in place; a manual close focuses the process control before hiding its members. The session-scoped store records only manually expanded Turn-and-answer-Step generations; a different answer generation starts collapsed.

-----

<a id="scroll-ownership"></a>
## Scroll ownership

Chat restores semantic anchors across history prepend and renderer remounts. Pinned scroll deliveries without reader movement update follow ownership immediately, before subsequent layout changes can invalidate their floor. Reader movement remains pending until the sampling interval or `scrollend`, even inside the follow threshold, so layout growth cannot erase small scroll gestures. While the reader is pinned to the floor, `ResizeObserver` follows the new floor and selects the latest loaded Turn without reading row geometry. Once the reader moves away, flow-height changes preserve the top position and the reading-line geometry selects the active Turn. Turn-rail previews paint above sticky Markdown code-block banners, while the rail frame remains inside the transcript band above the composer.

-----

<a id="reply-exposure"></a>
## Reply exposure

Chat provides the read-only `chatReplyExposure` service through `ChatReplyExposure`. Its observable identifies the current Session and its latest completed closing answer by seq while a rendered answer block is visibly exposed in a focused, visible document; otherwise it publishes `null`. Scrollport geometry and hit testing exclude offscreen or covered content, and reasoning alone does not qualify. Selection or historical navigation alone provides no evidence. The renderer reports through an injected callback, and leaving the answer or disposing its renderer withdraws the observation. [ui-digest](../ui-digest/README.md#reading-and-acknowledgement) owns the grace interval, settings, manual action, and durable seen writes. Exposure does not establish comprehension.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders logged conversation state in the browser and registers nothing model-facing.

#### KV Cache effect

None; Chat presentation does not assemble or mutate provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The transcript reflects the loaded Session window** — older transcript nodes become available only after Session Controller loads the preceding event page. Turn navigation is wider than the window: the rail merges the loaded Turns with the host `turnOutline` projection, so every started Turn gets a fixed-pitch mark (10px apart; a ladder taller than the frame scrolls inside it with gradient fades), and activating an unloaded mark pages history through the Turn's `turn/start` seq before landing on its row. Without the projection (assemblies not mounting `dsh-session-turn-outline`) the rail falls back to loaded Turns only.
- **Rail previews are card-sized** — one prompt line (50 characters) and up to three response lines (120), on loaded and unloaded Turns alike; an unloaded Turn's response arrives from the outline only once the Turn settled, so an open Turn previews its prompt (or just the Turn number) until then.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation and Slot registration enforce Chat target consistency.
