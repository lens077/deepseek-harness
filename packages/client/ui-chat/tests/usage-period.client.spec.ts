import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UsageCalendarDay } from '@deepseek-ai/dsh-session-stats/client'
import { periodDateRange, rollupPeriodUsage } from '../src/client/chat/usage-period.ts'
import { usageLedger, usageList } from './usage-fixture.client.ts'

const NOW = Date.UTC(2026, 8, 26, 3)
function day(date: string, count = 100): UsageCalendarDay {
  return { date, requests: 1, incompleteRequests: 0, unreportedAttempts: 0, unpricedRequests: 0,
    uncachedInputTokens: count, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 30,
    estimatedCost: 0.01, observedCost: 0.01 }
}
const ledger = () => usageLedger({ calendar: { timeZone: 'Asia/Shanghai', days: [
  day('2026-08-31'), day('2026-09-01'), day('2026-09-20'), day('2026-09-21'), day('2026-09-26'), day('2026-09-27'),
] } })

describe('calendar usage periods', () => {
  it('computes host-calendar days, Monday weeks and calendar months across year and DST boundaries', () => {
    expect(periodDateRange('today', Date.UTC(2026, 8, 25, 17), 'Asia/Shanghai')).toEqual({ start: '2026-09-26', end: '2026-09-26' })
    expect(periodDateRange('week', NOW, 'Asia/Shanghai')).toEqual({ start: '2026-09-21', end: '2026-09-26' })
    expect(periodDateRange('month', NOW, 'Asia/Shanghai').start).toBe('2026-09-01')
    expect(periodDateRange('week', Date.UTC(2026, 0, 1), 'UTC').start).toBe('2025-12-29')
    expect(periodDateRange('today', Date.UTC(2026, 2, 8, 7), 'America/New_York').start).toBe('2026-03-08')
  })

  it('uses dated own-request buckets, not session update time or lifetime totals', () => {
    const current = ledger()
    const list = usageList({ root: current })
    expect(rollupPeriodUsage('today', NOW, undefined, undefined, list)).toMatchObject({
      tokens: 150, requests: 1, estimatedCost: 0.01, missingSessions: 0, timeZone: 'Asia/Shanghai',
    })
    expect(rollupPeriodUsage('week', NOW, undefined, undefined, list).requests).toBe(2)
    expect(rollupPeriodUsage('month', NOW, undefined, undefined, list).requests).toBe(4)
    expect(rollupPeriodUsage('today', NOW, 'root' as SessionId, usageLedger({ calendar: { timeZone: 'Asia/Shanghai', days: [] } }), list).tokens).toBe(0)
  })

  it('deduplicates child discoveries and discloses missing and mismatched calendar snapshots', () => {
    const list = usageList({ root: ledger(), child: ledger(), old: usageLedger(), blank: undefined })
    list.byId['blank' as SessionId]!.blank = true
    list.subagentsByParent = { ['root' as SessionId]: { state: 'ready', error: null, entries: [
      { kind: 'child', id: 'child' as SessionId, mode: 'continuable', label: 'child', activity: 'inactive', hasChildren: false },
      { kind: 'diagnostic', id: 'missing' as SessionId, reason: 'corrupt' },
    ] } }
    const result = rollupPeriodUsage('today', NOW, undefined, undefined, list)
    expect(result).toMatchObject({ tokens: 300, requests: 2, knownSessions: 2, missingSessions: 2 })
    expect(result.estimatedCost).toBeUndefined()
    const other = usageLedger({ calendar: { timeZone: 'UTC', days: [day('2026-09-26')] } })
    expect(rollupPeriodUsage('today', NOW, undefined, undefined, usageList({ root: ledger(), other })).missingSessions).toBe(1)
  })

  it('never labels partial or unpriced traffic as a complete cost and keeps currency separate', () => {
    const incomplete = ledger()
    const unpricedDay = day('2026-09-26')
    delete unpricedDay.estimatedCost
    incomplete.calendar!.days = [{ ...unpricedDay, incompleteRequests: 1, unreportedAttempts: 1, unpricedRequests: 1 }]
    const result = rollupPeriodUsage('today', NOW, undefined, undefined, usageList({ root: incomplete }))
    expect(result).toMatchObject({ incompleteRequests: 1, unreportedAttempts: 1, unpricedRequests: 1 })
    expect(result.estimatedCost).toBeUndefined()
    const foreign = { ...ledger(), currency: 'EUR' }
    expect(rollupPeriodUsage('today', NOW, undefined, undefined, usageList({ root: ledger(), foreign })).mixedCurrencies).toBe(true)
    const list = usageList({ root: ledger() })
    list.phase = 'pending'
    expect(rollupPeriodUsage('today', NOW, undefined, undefined, list).estimatedCost).toBeUndefined()
    expect(rollupPeriodUsage('today', NOW, undefined, undefined, usageList({ old: usageLedger() }))).toMatchObject({ missingSessions: 1, knownSessions: 0, timeZone: null })
  })
})
