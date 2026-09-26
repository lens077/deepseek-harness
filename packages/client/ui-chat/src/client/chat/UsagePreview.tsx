/** Compact calendar totals for the companion's non-modal anchored preview. */
import { useEffect, useState } from 'react'
import { Button, IconCloseOutline16, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompanionUsageProps } from './CompanionUsage.tsx'
import { formatTokens } from './token-format.ts'
import { rollupPeriodUsage, type UsagePeriod } from './usage-period.ts'
import css from './UsagePreview.module.css'

/** Render three calendar choices and only the headline usage figures.
 * @param props - framework data seats, current period, navigation callbacks, and copy.
 * @returns the compact usage preview, with incomplete data explicitly marked.
 */
export function UsagePreview({ sessionId, useProjection, useSessions, period, onScope, onClose, t }:
  Omit<CompanionUsageProps, 'initialScope'> & { period: UsagePeriod }) {
  const list = useSessions(value => value)
  const ledger = useProjection('usageLedger')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])
  const usage = rollupPeriodUsage(period, now, sessionId, ledger, list)
  const missing = usage.missingSessions > 0 || usage.discoveryPending
  const unknown = usage.knownSessions === 0
  const cost = usage.estimatedCost === undefined || usage.currency === undefined ? t('usage.preview.unknown')
    : t('usage.money', { currency: usage.currency, amount: Number(usage.estimatedCost.toPrecision(4)).toString() })
  return <div className={css.content} data-usage-period={period}>
    <header className={css.header}>
      <strong>{t('usage.preview.title')}</strong>
      <Button size="sm" className={css.close} aria-label={t('usage.close')} onClick={onClose}><IconCloseOutline16 /></Button>
    </header>
    <div className={css.periods} role="group" aria-label={t('usage.scope')}>
      {(['today', 'week', 'month'] as const).map(value => <Pill key={value} active={period === value}
        aria-pressed={period === value} onClick={() => { onScope(value) }}>{t(`usage.period.${value}`)}</Pill>)}
    </div>
    <dl className={css.metrics}>
      <div><dt>{t('usage.preview.tokens')}</dt><dd>{unknown ? t('usage.preview.unknown') : formatTokens(usage.tokens, t)}</dd></div>
      <div><dt>{t('usage.preview.requests')}</dt><dd>{unknown ? t('usage.preview.unknown') : formatTokens(usage.requests, t)}</dd></div>
      <div><dt>{t('usage.preview.cost')}</dt><dd>{cost}</dd></div>
    </dl>
    <div className={css.status} role="status">
      {unknown ? <p>{t('usage.preview.unavailable')}</p> : <>
        {missing && <p>{t('usage.preview.partial', { known: usage.knownSessions, total: usage.knownSessions + usage.missingSessions })}</p>}
        {usage.unreportedAttempts + usage.incompleteRequests > 0 && <p>{t('usage.preview.incomplete')}</p>}
        <p>{t('usage.preview.range', { start: usage.start, end: usage.end })}</p>
      </>}
      {usage.timeZone !== null && <p>{t('usage.preview.timeZone', { zone: usage.timeZone })}</p>}
    </div>
    <footer className={css.footer}>
      <span>{t('usage.preview.note')}</span>
      <Button size="sm" onClick={() => { onScope('all') }}>{t('usage.preview.details')}</Button>
    </footer>
  </div>
}
