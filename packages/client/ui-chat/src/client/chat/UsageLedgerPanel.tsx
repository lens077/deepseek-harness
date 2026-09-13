/** Session, subagent-tree, and corpus disclosure over durable usage snapshots. */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Button, IconCloseOutline16, IconDatabaseOutline16, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { StatsPillsProps } from './StatsPills.tsx'
import { formatDuration } from './StatsPills.tsx'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { rollupUsage, usageAdvice, usageInput } from './usage-rollup.ts'
import type { UsageFinding, UsageScope } from './usage-rollup.ts'
import { useUsageDialog } from './usage-dialog.ts'
import pillCss from './StatsPills.module.css'
import css from './UsageLedgerPanel.module.css'

type Translate = StatsPillsProps['t']
type LedgerPillProps = Pick<StatsPillsProps, 'sessionId' | 'useSessions' | 't'> & {
  ledger: UsageLedgerProjection
  open: boolean
  setOpen: (open: boolean) => void
}

function money(value: number, currency: string, t: Translate): string {
  return t('usage.money', { currency, amount: Number(value.toPrecision(6)).toString() })
}

/**
 * Cost-first usage disclosure; only its open drawer subscribes to the corpus.
 * @param props - selected ledger, framework list seat, and exclusive open state.
 * @returns the trigger and its optional modal drawer.
 */
export function UsageLedgerPill(props: LedgerPillProps) {
  const { ledger, open, setOpen, t } = props
  const trigger = useRef<HTMLButtonElement>(null)
  const input = ledger.models.reduce((sum, model) => sum + usageInput(model), 0)
  const output = ledger.models.reduce((sum, model) => sum + model.outputTokens, 0)
  const read = ledger.models.reduce((sum, model) => sum + model.cacheReadTokens, 0)
  const steps = ledger.models.reduce((sum, model) => sum + model.steps, 0)
  const requests = ledger.models.reduce((sum, model) => sum + model.requests, 0)
  const { estimatedCost, currency } = ledger
  const priced = requests > 0 && estimatedCost !== undefined && currency !== undefined
    && ledger.unreportedAttempts === 0 && ledger.models.every(model => model.incompleteRequests === 0)
  const headline = priced
    ? t('usage.estimateCompact', { cost: money(estimatedCost, currency, t) })
    : requests > 0 ? t('message.turnUsage.count', { count: formatTokens(input + output, t) }) : t('usage.title')
  const cache = formatCacheHitPercent(read, input)
  const cacheLabel = cache === null ? null : t('stats.cacheHit', { percent: cache })
  const average = steps > 0 ? t('usage.inputPerStep', { tokens: formatTokens(Math.round(input / steps), t) }) : null
  const summary = [headline, cacheLabel, average].filter(value => value !== null).join(t('message.turnProcess.separator'))
  return (
    <span className={pillCss.anchor}>
      <button
        ref={trigger}
        className={pillCss.pill}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('usage.open', { summary })}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={pillCss.label}>{headline}</span>
        {cacheLabel !== null && <span className={css.triggerDetail}>{cacheLabel}</span>}
        {average !== null && <span className={css.triggerWide}>{average}</span>}
      </button>
      {open && <UsageLedgerDrawer {...props} trigger={trigger} />}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className={css.section}><h3>{title}</h3>{children}</section>
}

function Finding({ finding, t }: { finding: UsageFinding; t: Translate }) {
  const value = (n: number): string => finding.kind === 'cache' || finding.kind === 'ttft' || finding.kind === 'tools'
    ? t('usage.percent', { value: Number((n * 100).toFixed(1)) })
    : Number(n.toFixed(2)).toString()
  return (
    <li>
      <strong>{t(`usage.finding.${finding.kind}`)}</strong>
      <p className={css.note}>{t('usage.threshold', { value: value(finding.value), threshold: value(finding.threshold) })}</p>
    </li>
  )
}

function UsageLedgerDrawer({ ledger, sessionId, useSessions, t, setOpen, trigger }: LedgerPillProps & {
  trigger: RefObject<HTMLButtonElement>
}) {
  const list = useSessions(value => value)
  const [scope, setScope] = useState<UsageScope>('session')
  const totals = useMemo(() => rollupUsage(scope, sessionId, ledger, list), [scope, sessionId, ledger, list])
  const advice = useMemo(() => usageAdvice(totals, scope, ledger.governance), [totals, scope, ledger.governance])
  const content = useUsageDialog(trigger)
  const tokens = (n: number): string => t('message.turnUsage.count', { count: formatExactTokens(n, t) })
  const duration = (ms: number): string => formatDuration(ms, t)
  const input = usageInput(totals)
  const cache = formatCacheHitPercent(totals.cacheReadTokens, input)
  return (
    <Modal open headless title={t('usage.title')} onClose={() => { setOpen(false) }} className={css.drawer ?? ''}>
      <div ref={content} className={css.content} data-usage-panel data-usage-scope={scope}>
        <header className={css.header}>
          <h2>{t('usage.title')}</h2>
          <Button className={css.close} aria-label={t('usage.close')} onClick={() => { setOpen(false) }}>
            <IconCloseOutline16 />
          </Button>
        </header>
        <div className={css.scopes} role="group" aria-label={t('usage.scope')}>
          {(['session', 'tree', 'all'] as const).map(value => (
            <Pill key={value} active={scope === value} aria-pressed={scope === value} onClick={() => { setScope(value) }}>
              {t(`usage.scope.${value}`)}
            </Pill>
          ))}
        </div>
        <div className={css.scroll}>
          <p className={css.note}>{t('usage.coverage', {
            known: totals.sessionIds.length - totals.missingSessions, total: totals.sessionIds.length, requests: totals.requests,
          })}</p>
          {totals.requests > 0 && (
            <div className={css.cost} data-usage-cost>
              <span>{totals.estimatedCost === undefined ? t('usage.costUnavailable') : t('usage.estimate')}</span>
              {totals.estimatedCost !== undefined && totals.currency !== undefined && (
                <strong>{money(totals.estimatedCost, totals.currency, t)}</strong>
              )}
            </div>
          )}
          <div className={css.notices} role="status">
            {totals.requests === 0 && <p>{t('usage.noRequests')}</p>}
            {totals.missingSessions > 0 && <p>{t('usage.missing', { count: totals.missingSessions })}</p>}
            {totals.discoveryPending && <p>{t('usage.pending')}</p>}
            {totals.incompleteRequests > 0 && <p>{t('usage.incomplete', { count: totals.incompleteRequests })}</p>}
            {totals.unreportedAttempts > 0 && <p>{t('usage.unreported', { count: totals.unreportedAttempts })}</p>}
            {totals.mixedCurrencies && <p>{t('usage.mixed')}</p>}
            {totals.unpricedRequests > 0 && <p>{t('usage.unpriced', { count: totals.unpricedRequests })}</p>}
          </div>
          {scope !== 'session' && <p className={css.note}>{t('usage.cold')}</p>}
          <p className={css.note}>{t('usage.ownOnly')}</p>
          <Section title={t('usage.tokens')}>
            <dl className={css.facts} data-session-stats-usage>
              <dt>{t('message.turnUsage.input')}</dt><dd>{tokens(totals.uncachedInputTokens)}</dd>
              <dt>{t('message.turnUsage.cacheRead')}</dt><dd>{tokens(totals.cacheReadTokens)}</dd>
              <dt>{t('message.turnUsage.cacheWrite')}</dt><dd>{tokens(totals.cacheWriteTokens)}</dd>
              <dt>{t('message.turnUsage.output')}</dt><dd>{tokens(totals.outputTokens)}</dd>
              {cache !== null && <><dt>{t('message.turnUsage.cacheHit')}</dt><dd>{t('usage.percent', { value: cache })}</dd></>}
              {totals.steps > 0 && <><dt>{t('usage.averageInput')}</dt><dd>{tokens(Math.round(input / totals.steps))}</dd></>}
            </dl>
            {totals.reasoningTokens !== undefined && <p className={css.note}>{t('usage.reasoningIncluded', { tokens: tokens(totals.reasoningTokens) })}</p>}
          </Section>
          {totals.models.length > 0 && <Section title={t('usage.models')}>
            <ul className={css.rows}>
              {totals.models.map(model => (
                <li key={JSON.stringify([model.currency, model.provider, model.model])}>
                  <div className={css.rowHeading}><strong>{`${model.provider}/${model.model}`}</strong>
                    {model.requests > 0 && model.estimatedCost !== undefined && model.currency !== undefined && (
                      <span>{money(model.estimatedCost, model.currency, t)}</span>
                    )}
                  </div>
                  <p className={css.note}>{t('usage.requests', { requests: model.requests, steps: model.steps })}</p>
                  <p className={css.note}>{tokens(usageInput(model) + model.outputTokens)}</p>
                </li>
              ))}
            </ul>
          </Section>}
          {totals.tools.length > 0 && <Section title={t('usage.tools')}>
            <ul className={css.rows}>
              {totals.tools.map(tool => <li key={tool.name}>
                <div className={css.rowHeading}><strong>{tool.name}</strong><span>{duration(tool.toolMs)}</span></div>
                <p className={css.note}>{t('usage.toolCounts', { calls: tool.calls, results: tool.results, errors: tool.errors })}</p>
              </li>)}
            </ul>
          </Section>}
          <Section title={t('usage.activity')}>
            <p className={css.note}>{t('stats.counts', { turns: totals.activity.turns, steps: totals.activity.steps })}</p>
            <dl className={css.facts}>
              <dt>{t('usage.turnTime')}</dt><dd>{duration(totals.activity.turnMs)}</dd>
              <dt>{t('stats.dialog.llmTime')}</dt><dd>{duration(totals.activity.llmMs)}</dd>
              {totals.activity.ttftRequests > 0 && <><dt>{t('stats.dialog.ttft')}</dt><dd>{duration(totals.activity.ttftMs / totals.activity.ttftRequests)}</dd></>}
              {totals.activity.decodeMs > 0 && <><dt>{t('stats.dialog.speed')}</dt><dd>{t('message.tokensPerSecond', { tps: Number((totals.activity.decodeTokens * 1000 / totals.activity.decodeMs).toFixed(1)) })}</dd></>}
              <dt>{t('usage.retries')}</dt><dd>{totals.activity.retries}</dd>
              <dt>{t('usage.retryDelay')}</dt><dd>{duration(totals.activity.retryDelayMs)}</dd>
              <dt>{t('usage.failures')}</dt><dd>{t('usage.failureCounts', { errors: totals.activity.turnErrors, interruptions: totals.activity.interruptions })}</dd>
            </dl>
          </Section>
          <Section title={t('usage.cacheChanges')}>
            <dl className={css.facts}>
              <dt>{t('usage.cacheTotal')}</dt><dd>{totals.cacheBreaks.total}</dd>
              <dt>{t('usage.systemChanged')}</dt><dd>{totals.cacheBreaks.systemChanged}</dd>
              <dt>{t('usage.toolsChanged')}</dt><dd>{totals.cacheBreaks.toolsChanged}</dd>
              <dt>{t('usage.routeChanged')}</dt><dd>{totals.cacheBreaks.routeChanged}</dd>
            </dl>
            <p className={css.note}>{t('usage.cacheNote')}</p>
          </Section>
          {advice.budget !== undefined && totals.currency !== undefined && <Section title={t('usage.budget')}>
            <p className={css.budget} data-usage-budget={advice.budget.state}>
              {t(`usage.budget.${advice.budget.state}`, { limit: money(advice.budget.limit, totals.currency, t) })}
            </p>
            <p className={css.note}>{t('usage.budgetNote')}</p>
          </Section>}
          <Section title={t('usage.waste')}>
            {advice.findings.length > 0
              ? <ul className={css.rows}>{advice.findings.map(finding => <Finding key={finding.kind} finding={finding} t={t} />)}</ul>
              : <p className={css.note}>{t(advice.wasteState === 'evaluated' ? 'usage.waste.clean' : `usage.waste.${advice.wasteState}`)}</p>}
          </Section>
          <p className={css.note}>{t('usage.disclaimer')}</p>
        </div>
      </div>
    </Modal>
  )
}
