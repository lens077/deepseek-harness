---
description: "Model-classified routing for deployments that want the session's own model to read each prompt and pick which configured model and reasoning effort answers it: writing choice descriptions, bounding the classifier call, and debugging a verdict."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router-llm

English | [中文](README.zh.md)

## Summary

`dsh-model-router-llm` lets the model a person already selected read each Web prompt first and decide which configured model and reasoning effort should answer it. You describe each choice in plain language — "short factual questions", "multi-file refactors" — and name the route or effort it stands for; the classifier answers with one choice id, or `baseline` to keep the person's route. Each prompt costs one small extra request with thinking off where the adapter honors it, and it waits for that request before queueing. Any failure, timeout, or unrecognized verdict keeps the baseline.

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

Mount this package instead of `dsh-model-router-rules` when prompt features such as length or a regular expression do not decide well enough and a model's reading of the prompt should.

### When to choose it

Choose this package when choices are easier to describe than to encode as conditions, and the extra request per prompt — its latency sits in the prompt's admission path — is acceptable. Choose `dsh-model-router-rules` for zero-latency deterministic decisions. Mount exactly one `dsh-model-router` provider.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-model-router-llm'
  config:
    choices:
      - id: fast
        description: Short factual questions, greetings, and quick lookups.
        provider: deepseek-official
        model: deepseek-v4-flash
        reasoningEffort: low
      - id: strong
        description: Design, debugging, or changes across several files.
        provider: deepseek-official
        model: deepseek-v4-pro
      - id: deep
        description: Long or ambiguous requests that need careful reasoning on the current model.
        reasoningEffort: high
    maxInputBytes: 8192
    maxOutputTokens: 16
    timeoutMs: 20000
```

| Field | Default | Meaning |
|---|---|---|
| `choices` | required, non-empty | Choices offered to the classifier; `baseline` is reserved |
| `choices[].id` | required | Verdict token without whitespace; matched case-insensitively |
| `choices[].description` | required | When the classifier should pick this choice, written for the model |
| `choices[].provider` | — | Registered provider of the route to propose; requires `model`, and the route must be one the registry advertises |
| `choices[].model` | — | Provider-owned model id of the route to propose; requires `provider` |
| `choices[].reasoningEffort` | — | Adapter-owned effort id on the proposed route, or on the person's route when no model is named |
| `maxInputBytes` | required | Maximum UTF-8 bytes of the framed prompt; a longer prompt keeps the baseline without a request |
| `maxOutputTokens` | required | Classifier output cap; a verdict is a few tokens |
| `timeoutMs` | required | End-to-end classifier deadline |
| `classifierReasoningEffort` | — | Effort for the classifier call on the baseline model; absent means the first effort that model advertises, or its default when it advertises none |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-model-router-llm) is the exhaustive source for every accepted field. A choice needs a route, an effort, or both. Loading fails with a named choice when the list is empty, an id repeats or is `baseline`, a description is blank, `provider` appears without `model`, or a limit is outside the schema's range.

### The classifier request

The request goes to the baseline route — the model the person selected — with `purpose: 'model-routing'`, which the DeepSeek adapter maps to thinking off, and the classifier effort described above. The system prompt lists every choice id with its description plus the reserved `baseline` line, and asks for exactly one id; the user message carries the prompt text and image flag as JSON so prompt text cannot break the framing. The verdict is matched exactly after trimming quotes and punctuation, else as the single choice id mentioned as a whole word; anything else is a failure.

### Reading a decision

Each Web prompt appends one `model/route` event whose `rule` is the chosen id and whose `reason` reads `classifier chose "<id>"`, or `classifier chose baseline`. A `reason` starting with `router failed:` names the classifier failure — timeout, provider error, framed prompt over `maxInputBytes`, or a verdict naming no single choice — and the baseline was applied. The consumer's own refusals (`effort only:` and `refused:`) are described in the [seam README](../model-router/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`LlmModelRouter` compiles the choice list and renders the system prompt once in its constructor. `route()` frames the prompt, checks `maxInputBytes`, resolves the classifier effort, streams one `ctx.llm` request under a `dsh-timeout` deadline, assembles text blocks only, and translates the verdict into the seam's decision: a choice's route with its effort, the baseline route with an effort-only choice's effort, or the baseline for the reserved verdict. The request is reconstructable from this configuration and the prompt the consumer logs as `user/message`, so the router writes no Session event of its own.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `LlmModelRouter`, `Config`, `ChoiceConfig`, choice compilation, the classifier request, and verdict parsing |
| — | No runtime invariant companion is published: the router keeps no state beyond its compiled choices and observes nothing that could diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Model router seam](../model-router/README.md) — the contract this provider implements and the consumer constraints applied to its answers.
- [Rule-list router](../model-router-rules/README.md) — the zero-latency alternative.
- [Session title generator](../../session/session-title-llm/README.md) — the same bounded auxiliary-request pattern applied to titles.
- [DeepSeek adapter](../llm-deepseek/README.md) — the `purpose` handling that turns thinking off for the classifier.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-model-router-llm) — every accepted config field.

-----

<a id="model-experience"></a>
## Model Experience

### Classifier request, once per Web prompt

#### What the model sees

The baseline model receives a system prompt listing each configured choice as `- <id>: <description>`, one reserved line `- baseline: keep the model the person selected; answer this when no other choice clearly fits.`, and the instruction to reply with exactly one choice id, followed by one user message framing the prompt text and image flag as JSON. The conversation model never sees this request or its verdict.

##### Verbatim system prompt frame

```markdown
You route one user prompt sent to an AI coding assistant to the choice that fits it best.
Choices:
- <id>: <description>
- baseline: keep the model the person selected; answer this when no other choice clearly fits.
Reply with exactly one choice id and nothing else.
```

#### Token effect

One auxiliary request per human Web prompt: the fixed system prompt, the framed prompt up to `maxInputBytes`, and at most `maxOutputTokens` of output. The conversation request is unchanged by the router itself; the consumer's applied route decides its effort and model.

#### KV Cache effect

Independent of the conversation request cache. The system prompt is a stable prefix across prompts on the same route, while each framed prompt differs from its first byte.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the classifier can and cannot decide; they are current package constraints, not a task backlog.

- **Latency on the admission path** — the prompt is queued only after the verdict or the deadline; a slow baseline model delays every prompt by that much.
- **Prompt text only** — the classifier sees the prompt and image flag, not the conversation or the workspace.
- **No durable request record** — unlike the session-title generator, the classifier request is not logged; it is reconstructable from configuration and the logged prompt.
- **No replay fixture** — keyless recorded sessions cannot pin its verdicts; coverage relies on unit tests with scripted adapters and real-API runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
