# Agent Note: Prompt-driven model and reasoning-effort routing

Status: proposed

English | [中文](2026-09-10-prompt-driven-model-routing.zh.md)

## Problem

Every conversation request uses the provider, model, and reasoning effort that a human or a caller selected. No component reads the incoming prompt and decides that a short factual question should run on a fast, economical model with thinking off, or that a multi-file refactor should run on the strongest model at high effort. The only model-side choice that exists today is per-delegation: `dsh-tool-subagent` lets the model pick a child route from the recorded `subagent/model-selection-policy` ([model-selected subagent routes](../../implemented/feature/2026-08-18-model-selected-subagent-routes.md)). The top-level session itself never changes route without a human action.

Adding an automatic router is not a matter of overriding `provider` and `model` in one listener, because the current selection machinery has behavior a naive router would violate:

- **A Web selection is also the default for new sessions.** `session.selectModel` in `dsh-api-session-controller` appends `model/selection` to the Session and then calls `ctx.agentDefaultModel.saveSelection()`, so the picked route becomes `currentSelection()` for every later top-level Session. A router that reused this command would silently rewrite the user's default on every turn.
- **The effective route is sticky.** `ApiSessionAgentController.selectionFor().current` returns the pending `model/selection`, else the latest logged `request/header` route, else the default. After one routed request, the logged header is the routed model, so a one-turn downgrade would persist for every following turn with no record that the user chose something else.
- **Compaction prices the previous route, not the next one.** `dsh-compaction-basic` runs at `agent/pre-step`, resolves the target from the latest `request/header`, and compares `ctx.tokenMeter.measure(session)` against that model's `contextWindow`. There is no switch-triggered compaction: a switch to a model with a smaller window is discovered only when the provider returns `CONTEXT_WINDOW_EXCEEDED`, and the `agent/request-error` recovery then performs one maximal balanced reduction per retry up to `maxOverflowRetries`. That recovery is lossy and unplanned.
- **Route changes invalidate the provider prefix cache.** Every provider/model switch forfeits KV-cache reuse of the whole history, and a switch to a route without `systemPromptUpdate: in-history` additionally consolidates retained in-history system nodes at the head. On a long session the recomputation can cost more than the cheaper model saves.
- **Capabilities are per exact model.** Image input, `contextWindow`, and reasoning-effort ids are exact-model metadata. Web prompt admission rejects an image against a text-only selection (`MODEL_DOES_NOT_SUPPORT_IMAGES`), `read_image` refuses on a text route, and an effort id the model does not declare fails with `UNSUPPORTED_REASONING_EFFORT` before network I/O.
- **The route is inherited.** Subagents without static route defaults take the parent's latest logged request route, the compaction summarizer and the session-title generator use the logged route, and a `[model changed: …]` user-role notice is appended on every provider/model change ([route-change notices](../../implemented/feature/2026-09-07-model-switch-notice.md)). Each of these observes a routed downgrade.
- **Five entry points own a selection.** Web (`session-controller`), the headless bundle, ACP (`session/set_config_option`, pinned per prompt), the SDK server (`InitializeParams`), and webhook sessions each construct a `ModelSelectionRef`. ACP and SDK clients are trusted controllers whose explicit route must not be overridden.

## Proposal

### Vocabulary

- **Baseline selection** — the route the human or caller owns: the Session's latest `model/selection` with `source: 'user'`, else `agentDefaultModel.currentSelection()`. The router never changes it and never saves it.
- **Routed selection** — the provider, model, and effort the router chose for one turn from the baseline and the prompt. It is applied through the Session-local `ModelSelectionRef`, so `installModelSelection` still snapshots it at prompt assembly, applies it in `agent/request`, and emits the route-change notice.
- **Tier** — a deployment-configured label (`fast`, `balanced`, `strong`) bound to an ordered list of exact `{ provider, model, reasoningEffort? }` candidates. The router chooses a tier; the first candidate that passes the constraints below wins.

### Capability seam

`dsh-model-router` (Service Definition, `ctx.modelRouter`) with one method:

```text
route(input: RouteInput, signal: AbortSignal): Promise<RouteDecision>
RouteInput  = { baseline, candidates: readonly TierCandidate[], prompt: PromptSummary, session: SessionFacts }
PromptSummary = { text: string, hasImage: boolean, byteLength: number, source: 'user' }
SessionFacts  = { measuredTokens: number, requestCount: number, lastReplaceGeneration: number, sinceCompaction: boolean }
RouteDecision = { tier: string, selection: ModelSelection, reason: string, rule?: string } | { tier: 'baseline', selection: baseline, reason }
```

Providers:

- `dsh-model-router-rules` — deterministic, configuration-owned: ordered rules over prompt byte length, presence of code fences or file references, listed keywords or regular expressions, image presence, and session token count. Zero latency, replayable in keyless snapshots, and the shipped default.
- `dsh-model-router-llm` — optional classifier: one bounded request with a new `purpose: 'model-routing'` on a configured fast route, thinking off, `maxInputBytes`, `timeoutMs`, and a fixed JSON output of `{ tier }`. Modeled on `dsh-session-title-llm`, except it runs in the prompt's critical path; any failure or timeout returns the baseline tier.

Consumer: prompt admission in `dsh-api-session-controller` (`SessionCommands.prompt`) and the headless bundle's prompt path. Both already resolve `selectionFor(agent)` before enqueue; the consumer runs `route()` there, then installs the routed selection through a new `routeForNextRequest(agent, decision)` that appends `model/selection` with `source: 'router'` plus a diagnostic `model/route` event and updates `selection.current` without calling `saveSelection()`. ACP, SDK, and webhook sessions keep their explicit routes; they may opt in later by declaring an `auto` option, which is out of scope here.

### Durable state and projection

`model/selection` gains a required `source: 'user' | 'router'` field; existing logs without the field read as `'user'` through the adjacent-migration rule. `model/route` is a new `ignorable: true` event carrying `{ baseline, decision, measuredTokens }` for Trajectory and the UI; it is not model-visible, and the model-visible effect remains the existing `request/header` and the route-change notice.

The `modelSelection` projection (`stateVersion` 3) tracks `baseline` (latest user selection or `null`), `routed` (latest router selection or `null`), and `lastUsed`. `selectionFor().current` returns `routed ?? baseline ?? loggedHeader ?? default` — the logged-header fallback stays for sessions that predate the field, but a routed session never falls back to a routed header as if the user had chosen it. The composer model seat renders `Auto → <model>` when `routed` differs from `baseline`, and an explicit pick in the seat writes a user `model/selection`, which pins the Session (routing suspended) until the user selects **Auto** again.

### Constraints enforced by the consumer before applying a decision

The consumer, not the provider, rejects a decision that violates any of the following, and falls back to the baseline with a logged `model/route` reason. Providers stay pure so the constraints are tested once.

1. **Never save.** The routed selection never reaches `agentDefaultModel.saveSelection()`. New Sessions start from the user's baseline.
2. **Capacity.** `resolveModelInfo(candidate).context.contextWindow × (1 − headroomRatio)` must exceed `ctx.tokenMeter.measure(session).totalTokens`; otherwise the candidate is skipped. This is the guard the current compaction plugin cannot provide because it prices the previous header's route.
3. **Switch cost.** A provider/model change is allowed only when it is cheap: the Session has no `request/header` yet, `surface.replaceGeneration` advanced since the last request (compaction or another replacement already broke the prefix), or `measuredTokens < stickyTokens`. Otherwise only the reasoning effort may change, because an effort-only change keeps the prefix and emits no notice. This rule also bounds notice flip-flop.
4. **Capability.** A prompt with an image, or a Session whose history contains image blocks, is routed only to a candidate whose `inputModalities` includes `image`. An effort is validated through `ctx.llm.resolveCallConfig()` against the exact candidate; an unsupported effort skips the candidate rather than being clamped.
5. **Availability.** `routeServed(provider)` must hold, matching the prompt command's existing rejection.
6. **Human prompts only.** Routing runs for `source.kind === 'user'` prompts from a human. Goal continuation rounds, Ralph rounds, subagent-delivered messages, and `inject()` context inherit the current routed selection.
7. **Pinned sessions.** A Session whose baseline was set explicitly in this Session after routing was enabled is not routed until the user re-enables Auto.

### Interactions that stay unchanged and are documented, not solved

- Subagents spawned during a routed turn inherit the routed route through the parent's latest logged request; `list_subagent_models` and explicit child routes remain the way to override. A `childRoute: 'baseline' | 'routed'` option is deferred.
- The compaction summarizer and session-title generator run on the logged route. Both accept any text-capable route.
- Mid-turn (step-level) routing between tool calls is out of scope: each step switch would break the prefix.
- Forks copy the parent's history and inherit its route; the fork tool exposes no route selection ([fork restriction](../../implemented/feature/2026-08-18-model-selected-subagent-routes.md)).

### Configuration and settings

A Host-owned `model-routing` setting, default off, with `enabled`, `tiers` (each an exact route list), and `provider: rules | llm`. `dsh-model-router-rules` config owns the ordered rule list, `headroomRatio`, and `stickyTokens`; `dsh-model-router-llm` config owns the classifier route and limits. No tunable is a source constant. The Plugins settings page stores the setting atomically like `subagent-model-selection`, and validation rejects a tier candidate whose provider is not registered at save time while still allowing unlisted model ids, because adapter catalogs are advisory.

### Delivery order

1. Seam, rules provider, and consumer — shipped as `dsh-model-router`, `dsh-model-router-rules`, and the `SessionCommandController.prompt` path. Rules name a configured route, an effort, or both; the consumer applies a route change only when the live registry advertises at least two routes, the proposal names one of them, an image prompt lands on an image-capable route, the measured Session fits the route's context window when known, and the effort resolves, and otherwise degrades to effort-only on the baseline. This stage is configuration-driven (a disabled base row an overlay enables), writes `model/route` without a `source` field on `model/selection`, carries the baseline forward on every `model/route` so the `modelSelection` projection (`stateVersion` 3) can restore it, and has no per-Session pin and no switch-cost guard: every human Web prompt is routed while a provider is mounted and the deployment-wide `model-routing.enabled` setting (a Plugins-page card) is on, whatever the Session length. A routed model whose request fails past `dsh-llm-retry` falls back to the baseline for one retry of the same step.
2. The switch-cost constraint, the `source` field, the Auto seat state, and Session pinning.
3. Optional LLM classifier provider with recorded e2e fixtures.

## Alternatives considered

**An Agent-scoped `agent/request` listener that overrides provider and model.** Rejected. The listener runs after prompt assembly, so the prompt text is not available where the decision must be made; a route set there bypasses `ModelSelectionRef`, so the route-change notice, the image admission check, and the composer seat would all describe the wrong model. Ordering against `installModelSelection`, whose own `agent/request` listener overwrites the resolved route after `next()`, would depend on `prepend`, which is not a documented extension point for precedence.

**Route through the existing `session.selectModel` command.** Rejected because that command saves the selection as the deployment default; a router must not own the user's default.

**A provider-side virtual model (`deepseek-auto`) that routes inside the gateway.** Rejected. The Harness would not know the effective `contextWindow`, image capability, or effort ids, so compaction pressure, image admission, and effort validation would all run against unknown metadata, and the request header could not record which model answered.

**Let the model select its own route through a tool.** Rejected as the default. It spends one step of the strongest model to decide that a cheaper one would suffice, and the decision arrives after the request that needed it. It may complement the router for delegation, which `dsh-tool-subagent` already provides.

**Reuse the `subagent-model-selection` allowlist as the tier list.** Rejected. That setting authorizes child routes the model may request; tiers are a ranking the router applies to the top-level Session. Sharing one list would make enabling one feature widen the other.

**Compact on every route switch so any window fits.** Rejected. Summarization is lossy and costs a request; the capacity constraint refuses the switch instead, and the switch-cost constraint prefers points where compaction has already broken the prefix.

## Acceptance criteria

- With the setting off, no `model/route` event is written and every entry point behaves as today; existing keyless snapshots are byte-identical.
- With rules routing enabled, a short question on a fresh Session logs `model/route`, `model/selection { source: 'router' }`, and a `request/header` on the `fast` tier; `agentDefaultModel.currentSelection()` is unchanged; the next new Session starts on the baseline.
- After a routed downgrade, an explicit seat pick writes `model/selection { source: 'user' }`, the following prompts are not routed, and selecting Auto resumes routing.
- A candidate whose `contextWindow` is below the measured history is skipped with a logged reason, and the turn completes on the baseline without `CONTEXT_WINDOW_EXCEEDED`.
- On a Session above `stickyTokens` with no surface replacement since the last request, only the effort changes and no route-change notice is appended.
- An image prompt is never routed to a text-only candidate.
- A keyless recorded-session snapshot covers the rules provider on a fresh Session, a sticky Session, and a pinned Session; a real-API e2e covers the LLM classifier and self-skips without a key.
- The `modelSelection` projection reads pre-field logs as `source: 'user'` and reconstructs `baseline`, `routed`, and pinned state on resume and fork.

## Risks

- The router runs in the prompt's critical path. The rules provider adds no latency; the LLM provider adds one bounded request per human prompt and must fail to the baseline within its timeout.
- Each route-change notice is retained history; constraint 3 bounds their number, but a deployment with `stickyTokens` set high will still see one notice per routed switch.
- A routed cheap model becomes the parent of every subagent spawned in that turn and the author of that turn's compaction summary and title. Deployments that need the strong model for delegation configure static child route defaults.
- `model/selection` gains a required field, which is a released Session data change under the adjacent-migration rule and needs its reader update and a `SESSION_FORMAT_VERSION` review.
- ACP, SDK, and webhook clients get no routing until they declare an `auto` option; a user who expects routing everywhere will see it only in Web and headless.
