---
description: "Rule-list model routing for deployments that want short questions on a fast configured model and code-heavy prompts on the strongest: writing rule conditions and outcomes, ordering them, and debugging why a prompt was routed."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router-rules

English | [中文](README.zh.md)

## Summary

`dsh-model-router-rules` picks the model, the reasoning effort, or both for each Web prompt from an ordered list of conditions you write in `cordis.yml`: prompt byte length, a regular expression, or whether an image is attached. A rule names one of your configured provider/model routes, an effort, or both; the first rule whose conditions all hold wins, and no match keeps the person's own route. Decisions cost no model call and replay identically. Routes and effort ids are checked against the live registry per prompt, so a rule naming a model you later remove is refused, not fatal.

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

Mount this package in the host plane of a Web composition and write rules from cheapest-to-decide to most specific.

### When to choose it

Choose this package when a few prompt features decide the model and effort well enough. Choose another `dsh-model-router` provider when the decision needs semantic classification. The shipped base composition carries this row disabled; enable it in an overlay with your own rule list.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-model-router-rules'
  config:
    rules:
      - id: short-question
        maxBytes: 240
        pattern: '[?？]\s*$'
        provider: deepseek-official
        model: deepseek-v4-flash
        reasoningEffort: low
      - id: code-block
        pattern: '```'
        provider: deepseek-official
        model: deepseek-v4-pro
      - id: long-prompt
        minBytes: 1200
        reasoningEffort: high
```

| Field | Default | Meaning |
|---|---|---|
| `rules` | required, non-empty | Ordered rules; the first complete match decides |
| `rules[].id` | required | Unique identifier recorded as `rule` on the `model/route` event |
| `rules[].pattern` | — | JavaScript regular expression source tested against the prompt text with the `u` and `s` flags |
| `rules[].maxBytes` | — | Match only when the prompt's UTF-8 byte length is at most this value |
| `rules[].minBytes` | — | Match only when the prompt's UTF-8 byte length is at least this value |
| `rules[].hasImage` | — | Match only when image presence equals this value |
| `rules[].provider` | — | Registered provider of the route to propose; requires `model`, and the route must be one the registry advertises |
| `rules[].model` | — | Provider-owned model id of the route to propose; requires `provider` |
| `rules[].reasoningEffort` | — | Adapter-owned effort id on the proposed route, or on the person's route when no model is named |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-model-router-rules) is the exhaustive source for every accepted field. A rule needs at least one condition and at least one outcome (a route, an effort, or both). Loading fails with a named rule when the list is empty, an id repeats, a rule has no condition or no outcome, names `provider` without `model`, `minBytes` exceeds `maxBytes`, or a pattern does not compile.

### Reading a decision

Each Web prompt appends one `model/route` event. `rule` names the winning rule and `reason` reads `rule "<id>" matched`; `no rule matched` means the baseline was applied again. A `reason` containing `effort only:` means the consumer refused the rule's route — fewer than two configured routes, a route the registry does not advertise, a text-only route for an image prompt, or a context window below the Session's measured tokens — and applied only the effort on the person's model. A `reason` starting with `refused:` means even that effort was rejected and the baseline was applied; change the rule to a route and effort the registry advertises.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`RulesModelRouter` compiles the rule list once in its constructor, failing loudly on any rule it could never apply. `route()` measures the prompt text in UTF-8 bytes, tests rules in order, and returns the first matching rule's route — or the baseline route when the rule names none — with the rule's effort when it has one. The class is a pure decision function: the consumer checks the route against the configured candidates, validates the effort against the exact model, and writes the durable record.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `RulesModelRouter`, `Config`, `RuleConfig`, and load-time rule compilation |
| — | No runtime invariant companion is published: the router keeps no state beyond its compiled rules and observes nothing that could diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Model router seam](../model-router/README.md) — the contract this provider implements and the consumer constraints applied to its answers.
- [Session Controller](../../api/session-controller/README.md) — where Web prompts consult the router.
- [DeepSeek adapter](../llm-deepseek/README.md) — the `off`, `low`, `high`, and `max` effort ids the official route declares.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-model-router-rules) — every accepted config field.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reasoning effort the `dsh-model-router` consumer applies to the next request; the request header and the provider adapter own the model-visible request.

#### KV Cache effect

A rule that names only an effort leaves the assembled prefix untouched; a rule that names another route forfeits provider-side reuse of the history on the new route, which the deployment weighs when writing rules.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the rule list can express; they are current package constraints, not a task backlog.

- **Prompt features only** — rules see the prompt's text and image presence, not the conversation, the workspace, or token pressure.
- **Routes and effort ids are not validated at load** — a rule's route is checked against the registry and its effort against the exact model only when a prompt matches it, because the catalog is user-editable and the baseline model is chosen per Session.
- **No cost or tier metadata** — rules name exact routes; the router has no notion of a cheaper or stronger model beyond what the rule author encodes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
