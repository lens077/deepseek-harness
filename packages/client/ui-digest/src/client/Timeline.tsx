/**
 * The timeline tab: every retained question of every session placed on the
 * day it was asked, newest first, with a sticky day header. A row opens the
 * session at that question.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DigestPanelProps } from './contract/slots.ts'
import type { TimelineDay } from './select.ts'
import { dayKey } from './select.ts'
import css from './DigestPanel.module.css'

/**
 * Localized label of one day: today, yesterday, or the calendar date.
 * @param day - the day.
 * @param now - current time.
 * @param t - copy.
 * @returns the label.
 */
function dayLabel(day: TimelineDay, now: number, t: DigestPanelProps['t']): string {
  if (day.key === dayKey(now)) return t('timeline.today')
  if (day.key === dayKey(now - 86_400_000)) return t('timeline.yesterday')
  return new Date(day.start).toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })
}

/**
 * Render the timeline tab.
 * @param props - the days, current time, copy, and the open callback.
 * @returns the tab element.
 */
export function Timeline({ days, now, t, openQuestion }: {
  days: readonly TimelineDay[]
  now: number
  t: DigestPanelProps['t']
  openQuestion: (id: SessionId, seq: number) => void
}) {
  if (days.length === 0) {
    return (
      <div className={css.empty}>
        <p className={css.emptyBody}>{t('timeline.empty')}</p>
      </div>
    )
  }
  return (
    <div className={css.timeline}>
      {days.map(day => (
        <section key={day.key} className={css.day}>
          <h3 className={css.dayLabel}>
            <span>{dayLabel(day, now, t)}</span>
            <span className={css.dayDate}>{day.key}</span>
            <span className={css.sectionCount}>{t('timeline.count', { count: day.entries.length })}</span>
          </h3>
          <ul className={css.dayList}>
            {day.entries.map(entry => (
              <li key={`${entry.sessionId}:${entry.seq}`} className={css.timelineRow}>
                <time className={css.timelineTime} dateTime={new Date(entry.at).toISOString()}>
                  {new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </time>
                <button
                  type="button"
                  className={css.timelineQuestion}
                  onClick={() => { openQuestion(entry.sessionId, entry.seq) }}
                  title={entry.text}
                >
                  {entry.text}
                  {entry.truncated ? '…' : ''}
                </button>
                <span className={css.timelineMeta}>
                  <span className={css.todoWorkspace}>{entry.workspaceTitle}</span>
                  <span className={css.todoSession}>{entry.title}</span>
                  <span className={entry.outcome === 'completed' ? css.badgeSuccess : css.badgeFailure}>
                    {t(`outcome.${entry.outcome ?? 'open'}`)}
                  </span>
                  {entry.changedFileCount > 0 && <span>{t('card.files', { count: entry.changedFileCount })}</span>}
                  {entry.current && <span className={css.currentMark}>{t('timeline.current')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
