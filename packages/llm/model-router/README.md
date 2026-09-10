---
description: "Shared contract for prompt-driven model routing: what a router may decide from a human prompt, how the consumer enforces and records it, and how to write a routing provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router

English | [中文](README.zh.md)

## Summary

`dsh-model-router` lets a deployment pick the model and reasoning effort per human prompt — a short question on the fast configured model, a pasted code block on the strongest, a long prompt with thinking raised — without touching the model seat. A provider such as `dsh-model-router-rules` reads the prompt, the owner's route, and the configured routes, then proposes the next request's route; the Web prompt path applies it, records it durably, and never saves it as the default. Use this package to write a routing provider or a consumer; mount a provider to get routing.

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

Mount one provider and routing runs for every Web prompt; this package alone routes nothing.

### When to choose it

Choose `dsh-model-router-rules` when deterministic conditions on the prompt — byte length, a regular expression, an image — decide the model or the reasoning effort. Choose this package when you implement a different decision procedure, such as a model classifier, or when you build a prompt path that should consult the mounted router. Do not mount it alone.

### What routing looks like

Before a human prompt is queued, the consumer reads the **baseline** — the route the person or caller owns, independent of anything a router applied earlier — collects the **candidates** — every provider/model route the live registry advertises — and calls `ctx.modelRouter.route()`. The answer is applied to the next prompt assembly through the Session-local selection, so the request header records the routed route and effort, a provider/model change appends the ordinary `[model changed: …]` notice, and one `model/route` event records the baseline, the applied route, the provider's justification, and the rule that decided. When no rule applies, the baseline is applied again, which restores the person's model and effort after an earlier routed request.

The consumer enforces its own constraints before applying an answer. A route change is applied only when at least two routes are configured, the proposal names one of them, an image prompt lands on a route declaring image input, the Session's measured tokens fit the route's context window when both are known, and the proposed effort resolves on that model; otherwise the proposal degrades to its effort on the baseline route — with one configured model, routing is effort-only. An effort the baseline model rejects, or a provider failure, keeps the baseline. Every refused constraint is recorded in the event's `reason`. Routing never rejects a prompt and never calls `agentDefaultModel.saveSelection()`, so new Sessions start from the person's default.

### Implementing a provider

Subclass `ModelRouter` and implement `route(input)`; mount the subclass as `ctx.modelRouter`. `input.baseline` is the owner's route, `input.candidates` lists the configured routes a proposal may name, and `input.prompt` carries the concatenated prompt text and whether an image is attached. An effort belongs to the proposed model: a proposal that changes the model without an effort asks for that model's default. Answer with the baseline unchanged when nothing applies. Providers are pure decision functions: they never validate against the live LLM registry and never write to the Session. A provider that performs I/O runs in the prompt's admission path and must bound its own latency.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The seam has three roles. This package is the Service Definition: the abstract `ModelRouter` service, the `ModelRouteInput` and `ModelRouteDecision` types, and the `model/route` Session event. A provider package supplies the decision. The consumer — `SessionCommandController.prompt` in `dsh-api-session-controller` — owns baseline derivation, constraint enforcement, application through `routeForNextRequest()`, and the durable record. Keeping enforcement in the consumer means each constraint is tested once and a provider cannot bypass it.

The baseline is the `modelSelection` projection's `baseline`: the latest user `model/selection`, else the baseline the latest `model/route` carried forward; a Session neither touched uses its current selection. Because every routing record re-states the baseline it started from, a chain of routed requests never loses the person's route, and the projection's `routed` field keeps a routed header from being mistaken for a user choice.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `ModelRouter` abstract service and the `ctx.modelRouter` declaration |
| [`src/types.ts`](src/types.ts) | Cordis-free route, input, decision, and `model/route` record types |
| — | No runtime invariant companion is published: the seam owns no relation between independent observations; the consumer's projection and the Session log each validate their own record. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Rule-list router](../model-router-rules/README.md) — the shipped deterministic provider and its rule conditions.
- [Session Controller](../../api/session-controller/README.md) — the Web prompt path that applies and records decisions.
- [Prompt-driven routing Agent Note](../../../.agents/notes/proposed/feature/2026-09-10-prompt-driven-model-routing.md) — the full design, constraints, and delivery order beyond effort-only routing.
- [Model-visible route-change notices](../../../.agents/notes/implemented/feature/2026-09-07-model-switch-notice.md) — why a provider/model change would add a history notice and why effort-only routing does not.
- [Persistence catalog](../../../docs/persistence-catalog.md#modelroute--log-only) — the durable `model/route` payload.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reasoning effort the consumer applies to the next request; the request header and the provider adapter own the model-visible request.

#### KV Cache effect

An effort-only decision leaves the assembled prefix untouched. A provider/model change forfeits provider-side reuse of the whole history on the new route and appends the route-change notice as retained history; the `model/route` event itself is log-only and never enters derived history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current routing surface; they are current package constraints, not a task backlog.

- **No switch-cost guard** — a route change is accepted whenever the constraints above hold, however long the Session is; the prefix recomputation and the retained notice are the deployment's cost to weigh when writing rules.
- **Image checks read the prompt, not the history** — a switch away from an image-capable model with image blocks in earlier turns is not refused.
- **Web prompts only** — headless, ACP, SDK, and webhook sessions keep their explicit routes and never consult the router.
- **No per-session opt-out** — with a provider mounted, every human Web prompt is routed; a person's effort choice is the baseline the router overrides per prompt, and a session-level Auto switch is deferred.
- **No cancellation input** — `route()` receives no signal because no shipped consumer owns one; a provider performing I/O bounds its own latency.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
