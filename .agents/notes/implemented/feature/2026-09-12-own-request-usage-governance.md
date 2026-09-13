# Agent Note: Own-request usage and advisory cost governance

Status: implemented

English | [中文](2026-09-12-own-request-usage-governance.zh.md)

## Problem

Token totals alone cannot answer which model consumed a budget, whether retries added traffic, or whether a fork reused rather than generated its inherited history. Summing log-wide values across parent and child sessions charges inherited requests twice. Missing usage and optional cache buckets can make an apparently exact price smaller than the observed workload warrants. Operators also need tool and prefix diagnostics without inspecting or exporting content.

## Decision

The existing session-stats plugin owns an additional `usageLedger` projection. It accounts for Session-owned Assistant settlements and reported compaction-summary requests, with exact inherited-prefix exclusion. Every durable attempt settlement is additive, including direct recovery retries without retry-plugin events; assembled and embedded usage for the same settlement are alternatives, not separate requests. Timing requires a recorded start and never reuses the preceding failed attempt's interval. Reasoning remains included in output. Logical usage steps and reporting requests are separate counters, so retry and compaction traffic do not invent agent steps.

A deployment supplies exact provider/model prices, currency, and optional non-overlapping UTC recurring tiers. The fold retains hour-of-week buckets and applies the current table to its view, including restored checkpoints. Missing or contradictory usage, unreconciled prompt buckets, and missing route prices suppress complete estimates. The wire parser enforces currency and completeness. Cold or unhydrated rows remain missing, not zero. These estimates are durable-snapshot diagnostics, not provider invoices or historical effective-date accounting.

The Web composer keeps the existing time pill and uses a cost-first usage pill to open a responsive drawer. The drawer aggregates the current session, its subagent-only descendants, or available nonempty sessions. It deduplicates durable ids and never sums ordinary forks into a subagent tree. Incomplete lists, missing ledgers, mixed currencies, or incomplete billing suppress total cost and budget evaluation. The current session's deployment policy governs the selected scope.

Budgets and sample-gated waste signals are advisory. They never cancel, downgrade, or reroute a request. Signals cover average input, cache hit, first-token share, retry frequency, tool errors, and request-prefix changes. First-token sample floors use measured requests. Prefix comparisons use effective system content, assembled tool schemas, and route, not sampling parameters. No prompt, schema text, tool arguments, or result content enters the ledger view. The drawer contains keyboard focus, makes the application background inert, restores the trigger, and supports mobile safe areas.

This monetary accounting decision partially supersedes the deferred-cost alternative in [privacy-safe observability](2026-08-24-privacy-safe-harness-observability.md); its exporter privacy rules remain independent. [Token projections](../architecture/2026-07-29-projected-token-usage-and-request-context.md) retain context pressure and exact per-Turn usage. [Composer pills](2026-09-07-composer-session-stats-pills.md) retain the time/usage grouping and composer spacing, while the richer usage drawer owns cost governance. None is fully superseded or archived.

## Alternatives considered

**Sum the token-meter projection across sessions.** Rejected for spending: that log-wide projection includes inherited events and lacks price allocation/completeness metadata. It remains a diagnostic fallback, not a billing source.

**Treat missing cache buckets or failed requests as zero.** Rejected. An exact provider total can prove omitted buckets are zero; absence alone cannot. A canceled pre-dispatch step may therefore conservatively hide an estimate rather than claim zero cost.

**Persist one per-step cost timeline in every list row.** Rejected. It grows with session length and repeats immutable log detail. Per-route recurring-hour buckets and operational aggregates provide bounded dimensions; full historical pricing and timelines need a separately bounded query.

**Enforce budgets by interrupting or switching models.** Rejected for this feature. A soft diagnostic cannot safely make execution decisions from lagging snapshots, incomplete provider reports, or configurable estimates.

## Consequences

The feature works locally without a collector, account, new model-visible event, or change to released Session formats. It makes price uncertainty explicit and preserves known traffic for investigation. It cannot account for provider work absent from durable settlements, including unlogged title calls, failed summarizers without a summary, external tools' bills, or pre-settlement process loss. Recurring UTC pricing does not include historical rate revisions, taxes, provider balances, or volume agreements.

## Verification

Focused projection and Loader tests pin retry settlement, canceled backoff, missing usage, optional-bucket reconciliation, fork ownership, content exclusion, schema rejection, tier edges, configuration failure, and checkpoint repricing. Client tests pin aggregation completeness, sample floors, budgets, and focus containment. The real composed Web E2E fixture exercises session/tree/all scopes, cold and seeded sessions, incomplete/unpriced traffic, keyboard behavior, mobile layout, and reproducible accessibility output.
