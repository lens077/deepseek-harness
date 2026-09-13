/** Deterministic Host projection values for usage presentation tests. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'

/** Build an own-request ledger with two reported attempts in one logical step. */
export function usageLedger(overrides: Partial<UsageLedgerProjection> = {}): UsageLedgerProjection {
  return {
    models: [{ provider: 'fixture', model: 'model', steps: 1, requests: 2, incompleteRequests: 0,
      uncachedInputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 100,
      reasoningTokens: 20, estimatedCost: 0.02 }],
    tools: [{ name: 'bash', calls: 2, results: 2, errors: 1, toolMs: 200 }],
    activity: { turns: 1, steps: 1, turnMs: 1500, llmMs: 1000, ttftMs: 100, ttftRequests: 2,
      decodeMs: 500, decodeTokens: 100, retries: 1, retryDelayMs: 300, turnErrors: 0, interruptions: 0 },
    cacheBreaks: { total: 1, systemChanged: 1, toolsChanged: 0, routeChanged: 0 },
    unreportedAttempts: 0, currency: 'USD', estimatedCost: 0.02,
    governance: { budgets: { session: 0.03, tree: 0.05, all: 0.1, warningRatio: 0.8 },
      waste: { minUsageSteps: 1, minToolCalls: 1, averageInputTokens: 500, cacheHitRatio: 0.9,
        ttftShare: 0.05, retryRatio: 0.5, cacheBreakRatio: 0.5, toolErrorRatio: 0.2 } },
    ...overrides,
  }
}

/** Build the framework list without a transport or runtime singleton. */
export function usageList(ledgers: Record<string, UsageLedgerProjection | undefined>): SessionListState {
  const ids = Object.keys(ledgers) as SessionId[]
  return {
    ids,
    byId: Object.fromEntries(ids.map(id => [id, {
      id, displayTitle: id, running: false, blank: false, updatedAt: 1,
      ...ledgers[id] === undefined ? {} : { projectionValues: { usageLedger: ledgers[id] } },
    }])),
    current: ids[0], phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}
