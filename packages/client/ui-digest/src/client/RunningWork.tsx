/** Running-card task details and cumulative work, using only recorded and Host-pushed facts. */
import type { DigestPanelProps } from './contract/slots.ts'
import type { InboxItem } from './select.ts'
import css from './RunningWork.module.css'

/**
 * Show the agent's current checklist, last recorded update, and cumulative work.
 * @param props - the running item and localized copy.
 * @returns bounded work details; missing projections create no inferred metrics.
 */
export function RunningWork({ item, t }: { item: InboxItem; t: DigestPanelProps['t'] }) {
  const work = item.work
  return (
    <div className={css.work} data-running-work="">
      {work?.tasks != null && (
        <div className={css.tasks}>
          <div className={css.line}>
            <span className={css.label}>{t('work.tasks')}</span>
            <span className={css.count}>{t('work.taskCount', { done: work.tasks.completed, total: work.tasks.total })}</span>
          </div>
          {work.tasks.active.length > 0 && (
            <ul className={css.list}>
              {work.tasks.active.map((task, index) => <li key={index}>{task}</li>)}
            </ul>
          )}
          {work.tasks.activeCount > work.tasks.active.length && (
            <span className={css.meta}>{t('work.moreTasks', { count: work.tasks.activeCount - work.tasks.active.length })}</span>
          )}
        </div>
      )}
      <div className={css.update}>
        <span className={css.label}>{t('card.latestUpdate')}</span>
        <p className={css.updateText}>
          {item.reply ?? t('card.noUpdate')}{item.replyTruncated && item.reply !== null ? '…' : ''}
        </p>
      </div>
      {work?.jobs !== undefined && work.jobs.activeCount > 0 && (
        <div className={css.jobs}>
          <div className={css.line}>
            <span className={css.label}>{t('work.jobs', { count: work.jobs.activeCount })}</span>
            {work.jobs.stoppingCount > 0 && <span className={css.meta}>{t('work.stopping', { count: work.jobs.stoppingCount })}</span>}
          </div>
          <ul className={css.list}>{work.jobs.labels.map((label, index) => <li key={index}>{label}</li>)}</ul>
          {work.jobs.activeCount > work.jobs.labels.length && <span className={css.meta}>{t('work.moreJobs', { count: work.jobs.activeCount - work.jobs.labels.length })}</span>}
        </div>
      )}
      {(work?.steps != null || work?.tools != null) && (
        <div className={css.metrics}>
          <div className={css.line}>
            {work.steps !== null && <span>{t(work.steps.includesInherited ? 'work.stepsInherited' : 'work.steps', { count: work.steps.count })}</span>}
            {work.tools !== null && <span>{t('work.tools', { calls: work.tools.calls, results: work.tools.results })}</span>}
            {work.tools !== null && work.tools.errors > 0 && <span className={css.errors}>{t('work.errors', { count: work.tools.errors })}</span>}
          </div>
          {work.tools !== null && work.tools.names.length > 0 && (
            <div className={css.toolNames}>
              {work.tools.names.map(tool => <span key={tool.name}>{t('work.toolCount', { name: tool.name, count: tool.calls })}</span>)}
              {work.tools.additionalNames > 0 && <span>{t('work.moreTools', { count: work.tools.additionalNames })}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
