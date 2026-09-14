---
description: "Durable session statistics and own-request usage estimates, with explicit pricing and advisory cost governance."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-stats

English | [中文](README.zh.md)

## Summary

Inspect model usage, estimated spend, tool failures, retry delays, and request-prefix changes without exporting prompts or connecting a billing service. The figures survive paging, compaction, and reloads. Forked sessions contribute only their own requests to cost totals. Configure exact route prices and optional soft budgets; incomplete usage never appears as a complete cost estimate. Existing clients can continue reading the separate `sessionStats` lifecycle figures.

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

Mount this plugin beside the Session store and projection registry. The Web bundle already mounts it; other assemblies opt in through their composition. Its two values are `sessionStats` for log-wide lifecycle figures and `usageLedger` for own-request accounting and diagnostics.

### Configure prices and optional budgets

This tested configuration uses example prices per million tokens and example cumulative budgets in USD. Replace them with the deployment's route prices and budget decisions. Omitting pricing disables cost estimates; omitting budgets disables budget reminders. The plugin rejects invalid numbers, overlapping UTC price windows, unknown fields, and budgets without pricing before registering either value.

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-session-stats'
  config:
    pricing:
      currency: USD
      routes:
        test/m: { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 }
    governance:
      budgets: { session: 5, tree: 20, all: 100, warningRatio: 0.8 }
```

Route keys match `provider/model` exactly. Exact routes are preferred; a unique model-only match may cover provider suffixes such as `-high` and `-thinking`, while ambiguous or unknown models remain unpriced. Each route declares uncached input, cache-read, cache-write, and output prices. Optional `tiers` multiply all four rates during non-overlapping UTC weekday/hour windows; the base rate applies otherwise. The Web bundle includes a small explicit USD seed for the current Claude, GPT, and DeepSeek routes and no monetary budget. It also enables `assumeMissingCacheBucketsZero`, matching TokenTracker's treatment of absent optional cache rates. Unknown routes remain unpriced instead of being guessed. The seed follows the [TokenTracker curated pricing approach](https://github.com/xiufengsun/TokenTracker/tree/main/src/lib/pricing): curated exact entries take precedence, while unresolved models remain unpriced. Replace or extend the table through the profile patch. The [config catalog](../../../docs/config-catalog.md) describes the fields.

### Interpret the figures

Billing input is uncached input plus cache reads plus cache writes. Reasoning tokens are an observed subset of output and are never added or priced separately. Each durable Assistant settlement contributes one request's final sample; an embedded sample is not added to the assembled sample. Failed attempts and reported compaction-summary requests contribute their own traffic. Compaction summaries add requests, not logical agent steps.

`usageLedger` excludes the exact fork-inherited event prefix. Model rows count usage-reporting requests separately from distinct usage-reporting steps; a retry routed to a different model can therefore have requests but zero steps. The ledger retains observed buckets when their allocation is incomplete, but hides route pricing and the complete total. A missing usage report, contradictory counters, or a closed model step without a settlement hides the complete total, while known priced rows remain available as an observed partial cost. An exact provider total can prove omitted cache buckets are zero; the configured tracker-compatible mode also treats absent optional cache buckets as zero.

The ledger's activity timing measures settled agent attempts with a recorded step entry or retry start, excluding scheduled backoff. A direct recovery retry without a recorded start contributes its usage but not an invented timing interval. First-token and decode timing use the compact stream's recorded timestamps. Tool rows pair dispatched calls with results by call id; orphan and duplicate results do not add cost or duration. Prefix diagnostics compare the effective system content, assembled tool schemas, and route between observed agent requests. They are investigation clues, not proof of actual cache misses or avoidable spend.

The Web usage drawer aggregates this session, this session plus its subagent descendants, or the available nonempty Session list. Ordinary forks are excluded from the subagent tree. Missing ledgers, incomplete usage, unpriced routes, and mixed currencies suppress complete totals and budgets. Budget reminders and waste detectors never stop, downgrade, or reroute execution; their thresholds come from the selected session's policy.

### Lifecycle compatibility

`sessionStats` keeps its existing log-wide turn/step counts and LLM/tool/first-token/decode timing. It includes inherited history and is not a cross-session spending source. Clients without `usageLedger` may show `tokenUsage` and lifecycle figures as diagnostics, but cannot infer monetary cost or own-session accounting from them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both values are synchronous projection units driven by the Session projection registry. Unloading the plugin removes both registrations. [The ledger fold](src/usage-ledger.ts) reads the immutable inherited-prefix count at initialization, retains inherited request context for attribution, and accumulates only Session-owned work. Header and system changes do not publish a new client value until accounting changes.

The ledger stores per-route UTC hour-of-week token buckets, tool aggregates, and bounded lifecycle state rather than a per-step timeline. It keeps hashes of active system nodes and tool schemas, not their content. Prices are evaluated when producing the view, so a restored token checkpoint uses the currently configured table. Recurring hour buckets do not preserve historical price effective dates. [Configuration validation and pricing](src/usage-config.ts) are independent of the [existing lifecycle fold](src/projection.ts).

The registry validates persisted state and wire output. Wire validation rejects cost without currency, route cost on incomplete buckets, and totals that omit unknown or unpriced attempts. [Projection tests](tests/usage-ledger.spec.ts) and [real Loader composition](tests/loader-composition.spec.ts) pin ownership, pricing, incomplete reports, replay, and configuration. No runtime invariant companion is published: there is no independently mutable second observation to compare with this pure fold.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session projections](../../../docs/subsystems/session-projection.md) — delivery, persisted checkpoints, and cold snapshots.
- [Web chat](../../client/ui-chat/README.md) — usage controls and scope selection.
- [Usage governance decision](../../../.agents/notes/implemented/feature/2026-09-12-own-request-usage-governance.md) — accounting ownership and deliberate limits.

-----

<a id="model-experience"></a>
## Model Experience

None, as the sessionStats unit folds already-logged step boundaries into a client-facing read model and registers nothing model-facing.

#### KV Cache effect

None; diagnostics do not assemble, modify, or send requests. Prefix-change counts describe observed requests without changing their cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Not a provider invoice:** estimates cover durable Assistant settlements and recorded compaction-summary usage, not unlogged title calls, failed summarizers without a summary, external tools' provider bills, or pre-settlement process loss.
- **Conservative missing usage:** even a step canceled before dispatch can hide the total because the log cannot prove zero traffic. Known token rows remain available for diagnosis.
- **Latest available durable snapshots:** cold list rows can lag their checkpoint or omit projections; seeded cold rows require hydration before exposing own-request values. Cross-session views disclose missing data rather than treating it as zero.
- **Current configured rates:** UTC tiers are recurring windows, not historical effective-date prices, volume discounts, taxes, or provider balances. Update deployment prices when the billing agreement changes.
- **Advisory heuristics:** high input, low cache hit, first-token share, retry rate, tool errors, and prefix changes can be legitimate. Sample floors reduce noise but do not prove waste or savings.

<a id="dev-note"></a>
### Dev Note

None.
