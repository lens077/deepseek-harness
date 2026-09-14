/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
    /** Own-request accounting, excluding a fork's inherited history. */
    usageLedger: UsageLedgerProjection
  }
}

/** Four separately priced buckets. Reasoning is a subset of output, never a fifth price. */
export interface UsageBuckets {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  /** Observed reasoning subset; absent when no request reports it. */
  reasoningTokens?: number | undefined
}

/** Reported traffic for one provider/model, independent of visible history. */
export interface UsageLedgerModelRow extends UsageBuckets {
  provider: string
  model: string
  /** Distinct usage-reporting logical steps, attributed to their first reporting route. */
  steps: number
  /** Attempts with a usable usage sample, including failed attempts. */
  requests: number
  /** Samples whose prompt buckets cannot be fully reconciled for pricing. */
  incompleteRequests: number
  /** Price of this route's reported traffic; absent for incomplete buckets or missing prices. */
  estimatedCost?: number
}

/** Dispatched calls and paired results; no result text or arguments are retained. */
export interface UsageLedgerToolRow {
  name: string
  calls: number
  results: number
  errors: number
  toolMs: number
}

/** Changes between observed request prefixes, not proof of cache misses or monetary loss. */
export interface UsageCacheChanges {
  total: number
  systemChanged: number
  toolsChanged: number
  routeChanged: number
}

/** Session-owned lifecycle figures; inherited fork events contribute nothing. */
export interface UsageActivity {
  turns: number
  steps: number
  turnMs: number
  llmMs: number
  ttftMs: number
  ttftRequests: number
  decodeMs: number
  decodeTokens: number
  /** Retry records scheduled, whether or not their backoff completes. */
  retries: number
  retryDelayMs: number
  turnErrors: number
  interruptions: number
}

/** Latest durable own-session diagnostic snapshot, not a provider invoice. */
export interface UsageLedgerProjection {
  models: UsageLedgerModelRow[]
  tools: UsageLedgerToolRow[]
  activity: UsageActivity
  cacheBreaks: UsageCacheChanges
  /** Settled attempts or closed model steps with no usable usage sample. */
  unreportedAttempts: number
  currency?: string
  /** Present only when all observed attempts have complete priced billing buckets. */
  estimatedCost?: number
  /** Sum of known priced requests, present even when unknown traffic suppresses the complete total. */
  observedCost?: number
  governance?: UsageGovernancePolicy
}

/** UTC recurring half-open hourly window. Sunday is 0, Saturday is 6. */
export interface UsagePricingWindow {
  /** UTC weekdays 0..6; omit to match every day. */
  weekdaysUtc?: number[]
  /** Integer [start, end) hours; 0 <= start < end <= 24. */
  hoursUtc: [number, number]
}

/** Multiplier applied to all four prices during non-overlapping recurring windows. */
export interface UsagePricingTier {
  /** Nonnegative factor applied to the route's base prices, such as 0.5 for half price. */
  multiplier: number
  /** Matching UTC windows; overlaps within a route are rejected. */
  windows: UsagePricingWindow[]
}

/** Prices per million tokens in the table's currency. */
export interface UsageRoutePrice {
  /** Uncached prompt input price per million tokens. */
  input: number
  /** Cache-read price per million tokens. */
  cacheRead: number
  /** Cache-write price per million tokens. */
  cacheWrite: number
  /** Inclusive output price per million tokens; reasoning is not priced again. */
  output: number
  /** Optional recurring discounts or surcharges; unmatched hours use the base prices. */
  tiers?: UsagePricingTier[]
}

/** Deployment-owned prices keyed by exact `provider/model`, never guessed from model names. */
export interface UsagePricingTable {
  /** Uppercase three-letter ISO 4217 currency for all rates and budgets. */
  currency: string
  /** Exact provider/model route keys; missing entries suppress complete cost totals. */
  routes: Record<string, UsageRoutePrice>
  /** Treat absent optional cache buckets as zero, matching local tracker semantics. */
  assumeMissingCacheBucketsZero?: boolean
}

/** Advisory cumulative budgets in the pricing table's currency. */
export interface UsageBudgetPolicy {
  /** Positive budget for the selected session's own requests. */
  session?: number
  /** Positive budget for the session and its subagent descendants. */
  tree?: number
  /** Positive budget for all available nonempty sessions. */
  all?: number
  /** Fraction in (0, 1] at which a warning starts; ratio >= 1 means exceeded. */
  warningRatio: number
}

/** Optional diagnostic thresholds. Ratios use 0..1 except retry/prefix changes per step. */
export interface UsageWastePolicy {
  /** Minimum reporting steps before input/cache/retry/prefix checks, or measured requests for TTFT. */
  minUsageSteps: number
  /** Minimum dispatched calls before the tool-error check. */
  minToolCalls: number
  /** Warn above this average billed-input token count per reporting step. */
  averageInputTokens?: number
  /** Warn below this cache-read share of all reported prompt tokens. */
  cacheHitRatio?: number
  /** Warn above this first-token waiting share of recorded model time. */
  ttftShare?: number
  /** Warn above this paired-error count divided by dispatched calls. */
  toolErrorRatio?: number
  /** Warn above this scheduled-retry count per reporting step; may exceed 1. */
  retryRatio?: number
  /** Warn above this prefix-change count per reporting step; may exceed 1. */
  cacheBreakRatio?: number
}

/** Read-only advice; never interrupts, downgrades, or reroutes an agent. */
export interface UsageGovernancePolicy {
  /** Optional cumulative budgets; require configured prices and currency. */
  budgets?: UsageBudgetPolicy
  /** Optional sample-gated heuristics; absent thresholds disable their individual checks. */
  waste?: UsageWastePolicy
}

/** Plugin configuration; no prices or budgets are inferred when absent. */
export interface UsageStatsConfig {
  /** Deployment price table; omit to display tokens without monetary estimates. */
  pricing?: UsagePricingTable
  /** Optional advisory budgets and diagnostic thresholds exposed with each ledger. */
  governance?: UsageGovernancePolicy
}
