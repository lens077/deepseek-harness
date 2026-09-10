---
description: "Rule-list model routing for deployments that want short questions answered with thinking low and code-heavy prompts with thinking high: writing rule conditions, ordering them, and debugging why a prompt was routed."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router-rules

English | [中文](README.zh.md)

## Summary

`dsh-model-router-rules` picks the reasoning effort for each Web prompt from an ordered list of conditions you write in `cordis.yml`: prompt byte length, a regular expression, or whether an image is attached. The first rule whose conditions all hold wins; no match keeps the person's own effort. Decisions cost no model call and replay identically, so a keyless recorded session can pin them. Effort ids are exact-model metadata, so a rule naming one the selected model lacks is refused per prompt rather than at load.

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

Choose this package when a few prompt features decide the effort well enough. Choose another `dsh-model-router` provider when the decision needs semantic classification. The shipped base composition carries this row disabled; enable it in an overlay with your own rule list.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-model-router-rules'
  config:
    rules:
      - id: short-question
        maxBytes: 240
        pattern: '[?？]\s*$'
        reasoningEffort: low
      - id: code-block
        pattern: '```'
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
| `rules[].reasoningEffort` | required | Adapter-owned effort id applied on the person's provider and model |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-model-router-rules) is the exhaustive source for every accepted field. Loading fails with a named rule when the list is empty, an id repeats, a rule has no condition, `minBytes` exceeds `maxBytes`, or a pattern does not compile.

### Reading a decision

Each Web prompt appends one `model/route` event. `rule` names the winning rule and `reason` reads `rule "<id>" matched`; `no rule matched` means the baseline was applied again. When the consumer refused the rule's effort — the selected model does not declare it — `reason` starts with `refused:` and the baseline was applied; change the rule's `reasoningEffort` to an id that model advertises, or select a model that has it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`RulesModelRouter` compiles the rule list once in its constructor, failing loudly on any rule it could never apply. `route()` measures the prompt text in UTF-8 bytes, tests rules in order, and returns the baseline with the first matching rule's effort; provider and model are never changed. The class is a pure decision function: the consumer validates the effort against the exact model and writes the durable record.

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

Selecting an effort leaves the assembled prefix untouched, so this provider preserves an already-reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the rule list can express; they are current package constraints, not a task backlog.

- **Prompt features only** — rules see the prompt's text and image presence, not the conversation, the workspace, or token pressure.
- **Effort ids are not validated at load** — a rule's effort is checked against the selected model only when a prompt matches it, because the model is chosen per Session.
- **No rule can select a model** — the seam's consumer accepts effort changes only.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
