/** Pure aggregation of Host-owned usage ledgers and read-only deployment advice. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  UsageActivity, UsageBuckets, UsageCacheChanges, UsageGovernancePolicy,
  UsageLedgerModelRow, UsageLedgerProjection, UsageLedgerToolRow,
} from '@deepseek-ai/dsh-session-stats/client'

/** Accounting audience; tree follows only subagent-owned edges. */
export type UsageScope = 'session' | 'tree' | 'all'

/** Route totals retain their currency even when the audience mixes currencies. */
export interface UsageModelTotal extends UsageLedgerModelRow {
  currency?: string
}

/** Observed own-request totals; absent ledgers never contribute fabricated zeros. */
export interface UsageRollup extends UsageBuckets {
  sessionIds: SessionId[]
  missingSessions: number
  discoveryPending: boolean
  models: UsageModelTotal[]
  tools: UsageLedgerToolRow[]
  activity: UsageActivity
  cacheBreaks: UsageCacheChanges
  requests: number
  steps: number
  incompleteRequests: number
  unreportedAttempts: number
  unpricedRequests: number
  mixedCurrencies: boolean
  currency?: string
  estimatedCost?: number
}

const emptyActivity = (): UsageActivity => ({
  turns: 0, steps: 0, turnMs: 0, llmMs: 0, ttftMs: 0, ttftRequests: 0,
  decodeMs: 0, decodeTokens: 0, retries: 0, retryDelayMs: 0, turnErrors: 0, interruptions: 0,
})

/**
 * Sum disjoint prompt buckets; reasoning already belongs to output.
 * @param usage - observed token buckets.
 * @returns prompt-side input tokens.
 */
export function usageInput(usage: UsageBuckets): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Select an audience from the list and discovered catalogs, deduplicating identities.
 * Current-session projection data supersedes its possibly stale list hint.
 * @param scope - requested audience.
 * @param currentId - selected Session.
 * @param current - latest selected Session ledger, if served.
 * @param list - framework Session list and parent-addressed catalogs.
 * @returns observed totals with explicit incompleteness and currency information.
 */
export function rollupUsage(
  scope: UsageScope,
  currentId: SessionId,
  current: UsageLedgerProjection | undefined,
  list: SessionListState,
): UsageRollup {
  const ids = new Set<SessionId>([...list.ids, currentId])
  const children = new Map<SessionId, Set<SessionId>>()
  const addChild = (parent: SessionId, child: SessionId): void => {
    ids.add(child)
    let entries = children.get(parent)
    if (entries === undefined) children.set(parent, entries = new Set())
    entries.add(child)
  }
  for (const row of Object.values(list.byId)) {
    if (row.origin === 'subagent' && row.parentId !== undefined) addChild(row.parentId, row.id)
  }
  for (const [parent, catalog] of Object.entries(list.subagentsByParent)) {
    for (const row of catalog.entries) addChild(parent as SessionId, row.id)
  }
  const selected = new Set<SessionId>()
  const pending = scope === 'all' ? [...ids] : [currentId]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (selected.has(id)) continue
    selected.add(id)
    if (scope === 'tree') pending.push(...children.get(id) ?? [])
  }
  const selectedIds = [...selected].filter((id) => {
    if (id === currentId || list.byId[id]?.blank !== true) return true
    const ledger = list.byId[id].projectionValues?.usageLedger
    return scope === 'tree' && ledger !== undefined && (ledger.activity.steps > 0
      || ledger.models.some(model => model.requests > 0)
      || ledger.tools.some(tool => tool.calls > 0) || ledger.unreportedAttempts > 0)
  })
  const totals: UsageRollup = {
    sessionIds: selectedIds, missingSessions: 0,
    discoveryPending: scope !== 'session' && list.phase !== 'ready',
    uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    models: [], tools: [], activity: emptyActivity(),
    cacheBreaks: { total: 0, systemChanged: 0, toolsChanged: 0, routeChanged: 0 },
    requests: 0, steps: 0, incompleteRequests: 0, unreportedAttempts: 0,
    unpricedRequests: 0, mixedCurrencies: false,
  }
  const models = new Map<string, UsageModelTotal>()
  const tools = new Map<string, UsageLedgerToolRow>()
  const currencies = new Set<string>()
  let cost = 0
  let priced = true
  for (const id of selectedIds) {
    const ledger = id === currentId ? current : list.byId[id]?.projectionValues?.usageLedger
    if (ledger === undefined) {
      totals.missingSessions++
      continue
    }
    for (const key of Object.keys(totals.activity) as (keyof UsageActivity)[]) {
      totals.activity[key] += ledger.activity[key]
    }
    for (const key of Object.keys(totals.cacheBreaks) as (keyof UsageCacheChanges)[]) {
      totals.cacheBreaks[key] += ledger.cacheBreaks[key]
    }
    totals.unreportedAttempts += ledger.unreportedAttempts
    const reported = ledger.models.reduce((sum, row) => sum + row.requests, 0)
    if (ledger.currency !== undefined) currencies.add(ledger.currency)
    if (reported > 0) {
      if (ledger.estimatedCost === undefined || ledger.currency === undefined) priced = false
      else cost += ledger.estimatedCost
    }
    for (const row of ledger.models) {
      totals.requests += row.requests
      totals.steps += row.steps
      totals.incompleteRequests += row.incompleteRequests
      if (row.estimatedCost === undefined) totals.unpricedRequests += row.requests
      for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'] as const) {
        totals[key] += row[key]
      }
      if (row.reasoningTokens !== undefined) totals.reasoningTokens = (totals.reasoningTokens ?? 0) + row.reasoningTokens
      const key = JSON.stringify([ledger.currency, row.provider, row.model])
      const previous = models.get(key)
      if (previous === undefined) {
        models.set(key, { ...row, ...ledger.currency === undefined ? {} : { currency: ledger.currency } })
      } else {
        for (const field of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'steps', 'requests', 'incompleteRequests'] as const) {
          previous[field] += row[field]
        }
        if (row.reasoningTokens !== undefined) previous.reasoningTokens = (previous.reasoningTokens ?? 0) + row.reasoningTokens
        if (previous.estimatedCost !== undefined && row.estimatedCost !== undefined) previous.estimatedCost += row.estimatedCost
        else delete previous.estimatedCost
      }
    }
    for (const row of ledger.tools) {
      const previous = tools.get(row.name)
      if (previous === undefined) tools.set(row.name, { ...row })
      else for (const key of ['calls', 'results', 'errors', 'toolMs'] as const) previous[key] += row[key]
    }
  }
  totals.models = [...models.values()]
  totals.tools = [...tools.values()]
  totals.mixedCurrencies = currencies.size > 1
  const [currency] = currencies
  if (currencies.size === 1 && currency !== undefined) totals.currency = currency
  if (totals.requests > 0 && priced && currencies.size === 1 && usageComplete(totals)) totals.estimatedCost = cost
  return totals
}

/**
 * Check coverage of discovered Sessions and observed attempts.
 * @param usage - observed audience totals.
 * @returns whether all discovered Sessions and attempts supply complete token accounting.
 */
export function usageComplete(usage: UsageRollup): boolean {
  return usage.missingSessions === 0 && !usage.discoveryPending
    && usage.incompleteRequests === 0 && usage.unreportedAttempts === 0
}

/** Configured threshold exceeded by the observed audience. */
export interface UsageFinding {
  kind: 'input' | 'cache' | 'ttft' | 'tools' | 'retries' | 'prefix'
  value: number
  threshold: number
}

/** Advisory evaluation, never an execution restriction. */
export interface UsageAdvice {
  budget?: { limit: number; ratio: number; state: 'within' | 'warning' | 'exceeded' }
  findings: UsageFinding[]
  wasteState: 'unconfigured' | 'incomplete' | 'insufficient' | 'evaluated'
}

/**
 * Apply the selected Session's explicit policy to the observed audience.
 * @param usage - deduplicated own-request totals.
 * @param scope - budget audience.
 * @param policy - current Session policy, never inferred from other Sessions.
 * @returns budget status and threshold observations without modifying agents.
 */
export function usageAdvice(usage: UsageRollup, scope: UsageScope, policy?: UsageGovernancePolicy): UsageAdvice {
  const result: UsageAdvice = { findings: [], wasteState: 'unconfigured' }
  const budget = policy?.budgets
  const limit = budget?.[scope]
  if (usage.requests > 0 && usage.estimatedCost !== undefined && limit !== undefined && budget !== undefined) {
    const ratio = usage.estimatedCost / limit
    result.budget = { limit, ratio, state: ratio >= 1 ? 'exceeded' : ratio >= budget.warningRatio ? 'warning' : 'within' }
  }
  const waste = policy?.waste
  if (waste === undefined) return result
  if (!usageComplete(usage)) {
    result.wasteState = 'incomplete'
    return result
  }
  let evaluated = 0
  const check = (kind: UsageFinding['kind'], value: number, threshold: number | undefined, low = false): void => {
    if (threshold === undefined) return
    evaluated++
    if (low ? value < threshold : value > threshold) result.findings.push({ kind, value, threshold })
  }
  if (usage.steps > 0 && usage.steps >= waste.minUsageSteps) {
    check('input', usageInput(usage) / usage.steps, waste.averageInputTokens)
    if (usageInput(usage) > 0) check('cache', usage.cacheReadTokens / usageInput(usage), waste.cacheHitRatio, true)
    check('retries', usage.activity.retries / usage.steps, waste.retryRatio)
    check('prefix', usage.cacheBreaks.total / usage.steps, waste.cacheBreakRatio)
  }
  if (usage.activity.ttftRequests > 0 && usage.activity.ttftRequests >= waste.minUsageSteps && usage.activity.llmMs > 0) {
    check('ttft', usage.activity.ttftMs / usage.activity.llmMs, waste.ttftShare)
  }
  const calls = usage.tools.reduce((sum, tool) => sum + tool.calls, 0)
  if (calls > 0 && calls >= waste.minToolCalls) {
    check('tools', usage.tools.reduce((sum, tool) => sum + tool.errors, 0) / calls, waste.toolErrorRatio)
  }
  result.wasteState = evaluated === 0 ? 'insufficient' : 'evaluated'
  return result
}
