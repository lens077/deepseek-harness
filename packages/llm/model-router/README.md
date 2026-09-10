---
description: "Shared contract for prompt-driven model routing: what a router may decide from a human prompt, how the consumer enforces and records it, and how to write a routing provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router

English | [中文](README.zh.md)

## Summary

`dsh-model-router` lets a deployment adjust the model route per human prompt — a short question runs with thinking low, a pasted code block runs high — without the person touching the model seat. A provider such as `dsh-model-router-rules` reads the prompt and the route its owner selected, then proposes the route for the next request; the Web prompt path applies the answer, records it durably, and never saves it as the default. Reach for this package when you write a routing provider or a consumer that applies one; mount a provider when you want routing working.

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

Choose `dsh-model-router-rules` when deterministic conditions on the prompt — byte length, a regular expression, an image — decide the reasoning effort. Choose this package when you implement a different decision procedure, such as a model classifier, or when you build a prompt path that should consult the mounted router. Do not mount it alone.

### What routing looks like

Before a human prompt is queued, the consumer reads the **baseline** — the route the person or caller owns, independent of any effort a router applied earlier — and calls `ctx.modelRouter.route()`. The answer is applied to the next prompt assembly through the Session-local selection, so the request header records the routed effort, and one `model/route` event records the baseline, the applied route, the provider's justification, and the rule that decided. When no rule applies, the baseline is applied again, which restores the person's effort after an earlier routed request.

The consumer enforces its own constraints before applying an answer: only the reasoning effort may change, the effort must be one the exact model declares, and a provider failure keeps the baseline. Every refused answer is still recorded with the refusing reason. Routing never rejects a prompt and never calls `agentDefaultModel.saveSelection()`, so new Sessions start from the person's default.

### Implementing a provider

Subclass `ModelRouter` and implement `route(input)`; mount the subclass as `ctx.modelRouter`. `input.baseline` is the owner's route and `input.prompt` carries the concatenated prompt text and whether an image is attached. Answer with the baseline unchanged when nothing applies. Providers are pure decision functions: they never validate against the live LLM registry and never write to the Session. A provider that performs I/O runs in the prompt's admission path and must bound its own latency.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The seam has three roles. This package is the Service Definition: the abstract `ModelRouter` service, the `ModelRouteInput` and `ModelRouteDecision` types, and the `model/route` Session event. A provider package supplies the decision. The consumer — `SessionCommandController.prompt` in `dsh-api-session-controller` — owns baseline derivation, constraint enforcement, application through `routeForNextRequest()`, and the durable record. Keeping enforcement in the consumer means each constraint is tested once and a provider cannot bypass it.

The baseline is derived from the `modelSelection` projection: the latest user `model/selection` on the current route; otherwise, on a Session no router touched, the logged header's own effort; otherwise the saved default's effort when it names the same route; otherwise no effort, so the model's default applies. The projection tracks the latest routed selection so a routed header is never mistaken for a user choice.

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

An effort change leaves the assembled prefix untouched, so routing preserves an already-reusable prefix; the `model/route` event is log-only and never enters derived history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current routing surface; they are current package constraints, not a task backlog.

- **Effort only** — the consumer refuses an answer that changes the provider or model. Route changes wait on the capacity and switch-cost constraints in the Agent Note.
- **Web prompts only** — headless, ACP, SDK, and webhook sessions keep their explicit routes and never consult the router.
- **No per-session opt-out** — with a provider mounted, every human Web prompt is routed; a person's effort choice is the baseline the router overrides per prompt, and a session-level Auto switch is deferred.
- **No cancellation input** — `route()` receives no signal because no shipped consumer owns one; a provider performing I/O bounds its own latency.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
