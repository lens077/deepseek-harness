import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { rollupUsage, usageAdvice, usageComplete, usageInput } from '../src/client/chat/usage-rollup.ts'
import { usageLedger, usageList } from './usage-fixture.client.ts'

const ROOT = 'root' as SessionId
const CHILD = 'child' as SessionId
const GRANDCHILD = 'grandchild' as SessionId
const FORK = 'fork' as SessionId

function tree() {
  const ledger = usageLedger()
  const list = usageList({ root: ledger, child: ledger, grandchild: ledger, fork: ledger, other: ledger })
  Object.assign(list.byId[CHILD]!, { parentId: ROOT, origin: 'subagent' })
  Object.assign(list.byId[GRANDCHILD]!, { parentId: CHILD, origin: 'subagent' })
  Object.assign(list.byId[FORK]!, { parentId: ROOT })
  list.subagentsByParent = {
    [ROOT]: { state: 'ready', error: null, parentAvailable: true,
      entries: [{ kind: 'child', id: CHILD, mode: 'continuable', label: 'child', activity: 'inactive', hasChildren: true }] },
  }
  return { ledger, list }
}

describe('usage scope aggregation', () => {
  it('deduplicates catalog and list identities and follows only subagent tree edges', () => {
    const { ledger, list } = tree()
    const session = rollupUsage('session', ROOT, ledger, list)
    expect(session.sessionIds).toEqual([ROOT])
    expect(session.estimatedCost).toBe(0.02)
    const subtree = rollupUsage('tree', ROOT, ledger, list)
    expect(new Set(subtree.sessionIds)).toEqual(new Set([ROOT, CHILD, GRANDCHILD]))
    expect(subtree.requests).toBe(6)
    expect(subtree.steps).toBe(3)
    expect(subtree.estimatedCost).toBeCloseTo(0.06)
    expect(subtree.activity.retries).toBe(3)
    expect(subtree.tools[0]?.calls).toBe(6)
    expect(subtree.models).toHaveLength(1)
    expect(rollupUsage('all', ROOT, ledger, list).estimatedCost).toBeCloseTo(0.1)
  })

  it('uses the current projection instead of a stale list hint and never recounts fork history', () => {
    const { list } = tree()
    const own = usageLedger({ estimatedCost: 0.01, models: [{ ...usageLedger().models[0]!, estimatedCost: 0.01 }] })
    const result = rollupUsage('session', FORK, own, list)
    expect(result.estimatedCost).toBe(0.01)
    expect(usageInput(result)).toBe(1000)
    expect(result.outputTokens).toBe(100)
    expect(result.reasoningTokens).toBe(20)
  })

  it('discovers catalog-only diagnostics without presenting a complete cost', () => {
    const ledger = usageLedger()
    const list = usageList({ root: ledger })
    list.subagentsByParent = { [ROOT]: { state: 'ready', error: null,
      entries: [{ kind: 'diagnostic', id: CHILD, reason: 'corrupt' }] } }
    const result = rollupUsage('tree', ROOT, ledger, list)
    expect(result.missingSessions).toBe(1)
    expect(result.estimatedCost).toBeUndefined()
    expect(usageAdvice(result, 'tree', ledger.governance)).toMatchObject({ wasteState: 'incomplete', findings: [] })
  })

  it('excludes known blank rows from all-session accounting without hiding current or worked subtree rows', () => {
    const ledger = usageLedger()
    const list = usageList({ root: ledger, blank: undefined, child: ledger })
    list.byId['blank' as SessionId]!.blank = true
    Object.assign(list.byId[CHILD]!, { blank: true, origin: 'subagent', parentId: ROOT })
    list.byId[ROOT]!.blank = true
    const all = rollupUsage('all', ROOT, ledger, list)
    expect(all.sessionIds).toEqual([ROOT])
    expect(all.estimatedCost).toBe(0.02)
    expect(all.missingSessions).toBe(0)
    expect(new Set(rollupUsage('tree', ROOT, ledger, list).sessionIds)).toEqual(new Set([ROOT, CHILD]))
  })

  it.each([false, true])('suppresses foreign-currency totals against an empty current ledger in either ordering (reverse=%s)', (reverse) => {
    const current = usageLedger({ currency: 'USD', models: [], tools: [], estimatedCost: 0 })
    const other = usageLedger({ currency: 'EUR' })
    const list = usageList(reverse ? { other, root: current } : { root: current, other })
    const totals = rollupUsage('all', ROOT, current, list)
    expect(totals.mixedCurrencies).toBe(true)
    expect(totals.estimatedCost).toBeUndefined()
    expect(usageAdvice(totals, 'all', current.governance).budget).toBeUndefined()
  })

  it('does not loop on catalog cycles', () => {
    const { ledger, list } = tree()
    Object.assign(list.byId[ROOT]!, { parentId: GRANDCHILD, origin: 'subagent' })
    expect(rollupUsage('tree', ROOT, ledger, list).sessionIds).toHaveLength(3)
  })

  it('retains currency-specific routes but suppresses mixed totals and budgets', () => {
    const ledger = usageLedger()
    const list = usageList({ root: ledger, other: usageLedger({ currency: 'EUR' }) })
    const result = rollupUsage('all', ROOT, ledger, list)
    expect(result.mixedCurrencies).toBe(true)
    expect(result.estimatedCost).toBeUndefined()
    expect(result.models.map(row => row.currency).sort()).toEqual(['EUR', 'USD'])
    expect(usageAdvice(result, 'all', ledger.governance).budget).toBeUndefined()
  })

  it.each(['missing', 'unreported', 'incomplete', 'pending'] as const)('marks %s usage incomplete and suppresses totals and clean verdicts', (kind) => {
    const ledger = usageLedger(kind === 'unreported' ? { unreportedAttempts: 1 }
      : kind === 'incomplete' ? { models: [{ ...usageLedger().models[0]!, incompleteRequests: 1 }] } : {})
    const list = usageList({ root: ledger, ...(kind === 'missing' ? { missing: undefined } : {}) })
    if (kind === 'pending') list.phase = 'pending'
    const result = rollupUsage('all', ROOT, ledger, list)
    expect(usageComplete(result)).toBe(false)
    expect(result.estimatedCost).toBeUndefined()
    expect(usageAdvice(result, 'all', ledger.governance)).toMatchObject({ wasteState: 'incomplete', findings: [] })
  })

  it('does not fabricate route prices or a total when prices are absent', () => {
    const base = usageLedger()
    const { estimatedCost: _cost, ...model } = base.models[0]!
    const { estimatedCost: _total, currency: _currency, ...unpriced } = base
    const ledger = { ...unpriced, models: [model] }
    const result = rollupUsage('session', ROOT, ledger, usageList({ root: ledger }))
    expect(result.unpricedRequests).toBe(2)
    expect(result.estimatedCost).toBeUndefined()
    expect(result.currency).toBeUndefined()
  })
})

describe('advisory governance', () => {
  it('uses logical reported steps for input and retry ratios, with TTFT samples gated independently', () => {
    const ledger = usageLedger()
    const totals = rollupUsage('session', ROOT, ledger, usageList({ root: ledger }))
    const advice = usageAdvice(totals, 'session', ledger.governance)
    expect(advice.findings.map(row => [row.kind, row.value])).toEqual([
      ['input', 1000], ['cache', 0.8], ['retries', 1], ['prefix', 1], ['ttft', 0.1], ['tools', 0.5],
    ])
    totals.activity.ttftRequests = 0
    expect(usageAdvice(totals, 'session', ledger.governance).findings.some(row => row.kind === 'ttft')).toBe(false)
  })

  it('distinguishes advisory warning, exceeded, and below-warning states', () => {
    const ledger = usageLedger()
    const totals = rollupUsage('session', ROOT, ledger, usageList({ root: ledger }))
    for (const [limit, state] of [[0.03, 'within'], [0.024, 'warning'], [0.02, 'exceeded'], [0.01, 'exceeded']] as const) {
      expect(usageAdvice(totals, 'session', { budgets: { session: limit, warningRatio: 0.8 } }).budget?.state).toBe(state)
    }
    expect(usageAdvice(totals, 'tree', { budgets: { session: 0.03, warningRatio: 0.8 } }).budget).toBeUndefined()
  })

  it('does not invent a clean diagnosis without configured thresholds or enough observations', () => {
    const ledger = usageLedger()
    const totals = rollupUsage('session', ROOT, ledger, usageList({ root: ledger }))
    expect(usageAdvice(totals, 'session').wasteState).toBe('unconfigured')
    expect(usageAdvice(totals, 'session', { waste: { minUsageSteps: 3, minToolCalls: 3, ttftShare: 0.5 } }).wasteState).toBe('insufficient')
    expect(usageAdvice(totals, 'session', { waste: { minUsageSteps: 1, minToolCalls: 1, cacheHitRatio: 0.5 } })).toMatchObject({ wasteState: 'evaluated', findings: [] })
  })

  it('shows no cost or budget for a ledger with no reported requests', () => {
    const ledger = usageLedger({ models: [], estimatedCost: 0 })
    const totals = rollupUsage('session', ROOT, ledger, usageList({ root: ledger }))
    expect(totals.estimatedCost).toBeUndefined()
    expect(usageAdvice(totals, 'session', ledger.governance).budget).toBeUndefined()
  })
})
