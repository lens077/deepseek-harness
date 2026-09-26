/** Calendar-period summaries over dated own-request snapshots; absent history stays unknown. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'

/** Calendar ranges begin at local midnight in the accounting timezone; weeks start Monday. */
export type UsagePeriod = 'today' | 'week' | 'month'

/** Compact values plus the evidence needed to avoid presenting incomplete usage as a total. */
export interface PeriodUsage {
  timeZone: string | null
  start: string
  end: string
  tokens: number
  requests: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  knownSessions: number
  missingSessions: number
  discoveryPending: boolean
  incompleteRequests: number
  unreportedAttempts: number
  unpricedRequests: number
  mixedCurrencies: boolean
  currency?: string
  estimatedCost?: number
}

/** Resolve date-only bounds in the projection's configured timezone.
 * @param period - today, Monday-based current week, or current calendar month.
 * @param now - current Unix timestamp in milliseconds.
 * @param timeZone - accounting timezone carried by the Host projection.
 * @returns inclusive date strings; future dates are excluded from every range.
 */
export function periodDateRange(period: UsagePeriod, now: number, timeZone: string): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string): number => Number(parts.find(part => part.type === type)?.value)
  const calendar = new Date(Date.UTC(get('year'), get('month') - 1, get('day')))
  const end = calendar.toISOString().slice(0, 10)
  if (period === 'week') calendar.setUTCDate(calendar.getUTCDate() - (calendar.getUTCDay() + 6) % 7)
  if (period === 'month') calendar.setUTCDate(1)
  return { start: calendar.toISOString().slice(0, 10), end }
}

/** Aggregate discovered Sessions without substituting cumulative totals for missing daily history.
 * @param period - requested calendar period.
 * @param now - current time sampled while the card is open.
 * @param currentId - optional current Session, whose live projection takes precedence.
 * @param current - current Session ledger, if available.
 * @param list - discovered Session hints and child catalogs.
 * @returns compact totals with missing-data and pricing status.
 */
export function rollupPeriodUsage(period: UsagePeriod, now: number, currentId: SessionId | undefined,
  current: UsageLedgerProjection | undefined, list: SessionListState): PeriodUsage {
  const ids = new Set(list.ids)
  if (currentId !== undefined) ids.add(currentId)
  for (const catalog of Object.values(list.subagentsByParent)) {
    for (const child of catalog.entries) ids.add(child.id)
  }
  const ledgers = [...ids].filter(id => id === currentId || list.byId[id]?.blank !== true)
    .map(id => id === currentId ? current : list.byId[id]?.projectionValues?.usageLedger)
  const timeZone = current?.calendar?.timeZone ?? ledgers.find(ledger => ledger?.calendar !== undefined)?.calendar?.timeZone ?? null
  const range = timeZone === null ? { start: '', end: '' } : periodDateRange(period, now, timeZone)
  const total: PeriodUsage = { timeZone, ...range, tokens: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    knownSessions: 0, missingSessions: 0, discoveryPending: list.phase !== 'ready', incompleteRequests: 0,
    unreportedAttempts: 0, unpricedRequests: 0, mixedCurrencies: false }
  const currencies = new Set<string>()
  let cost = 0
  let completePrice = true
  for (const ledger of ledgers) {
    if (ledger?.calendar === undefined || ledger.calendar.timeZone !== timeZone) { total.missingSessions++; continue }
    total.knownSessions++
    if (ledger.currency !== undefined) currencies.add(ledger.currency)
    for (const day of ledger.calendar.days) {
      if (day.date < range.start || day.date > range.end) continue
      const input = day.uncachedInputTokens + day.cacheReadTokens + day.cacheWriteTokens
      total.tokens += input + day.outputTokens
      total.inputTokens += input
      total.cacheReadTokens += day.cacheReadTokens
      total.outputTokens += day.outputTokens
      total.requests += day.requests
      total.incompleteRequests += day.incompleteRequests
      total.unreportedAttempts += day.unreportedAttempts
      total.unpricedRequests += day.unpricedRequests
      if (day.requests > 0) {
        if (day.estimatedCost === undefined || ledger.currency === undefined) completePrice = false
        else cost += day.estimatedCost
      }
    }
  }
  total.mixedCurrencies = currencies.size > 1
  const [currency] = currencies
  if (currencies.size === 1 && currency !== undefined) total.currency = currency
  if (total.knownSessions > 0 && total.missingSessions === 0 && !total.discoveryPending
    && total.incompleteRequests === 0 && total.unreportedAttempts === 0 && total.unpricedRequests === 0
    && completePrice && total.currency !== undefined) total.estimatedCost = cost
  return total
}
