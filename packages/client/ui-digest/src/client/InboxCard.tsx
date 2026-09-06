/**
 * Inbox cards show the newest question, closing answer, changed files, and
 * triage actions. Phone rows disclose those details on demand; the panel owns
 * expansion and every action.
 */
import { useId } from 'react'
import clsx from 'clsx'
import type { DigestPanelProps } from './contract/slots.ts'
import type { InboxItem } from './select.ts'
import css from './DigestPanel.module.css'

/** Actions the panel offers on one item; the keyboard ring calls the same ones. */
export interface InboxCardActions {
  open: (item: InboxItem) => void
  continueWork: (item: InboxItem) => void
  toggleHandled: (item: InboxItem) => void
  addTodo: (item: InboxItem) => void
  togglePinned: (item: InboxItem) => void
  snoozeUntilTomorrow: (item: InboxItem) => void
}

/**
 * Render one inbox item, with optional controlled phone disclosure.
 * @param props - the item, keyboard focus, localized copy, actions, and phone expansion.
 * @returns the card element.
 */
export function InboxCard({ item, focused, t, actions, disclosure }: {
  item: InboxItem
  focused: boolean
  t: DigestPanelProps['t']
  actions: InboxCardActions
  disclosure?: { expanded: boolean; toggle: () => void } | undefined
}) {
  const detailsId = useId()
  const tone = item.waiting
    ? css.waiting
    : item.running
      ? css.runningTone
      : item.outcome === 'completed'
        ? css.success
        : css.failure
  const badge = item.waiting
    ? t('card.waiting')
    : item.running
      ? t('section.running')
      : t(`outcome.${item.outcome ?? 'open'}`)
  return (
    <article
      className={clsx(css.card, tone, focused && css.focused, item.unread && css.unreadCard, disclosure && css.compactCard)}
      data-session-id={item.sessionId}
      data-focused={focused ? '' : undefined}
      aria-current={focused ? 'true' : undefined}
    >
      {disclosure && (
        <button
          type="button"
          className={css.rowDisclosure}
          aria-expanded={disclosure.expanded}
          aria-controls={detailsId}
          onClick={disclosure.toggle}
        >
          <span className={css.rowTitle} title={item.title}>{item.title}</span>
          {item.unread && <span className={css.unreadDot} role="img" aria-label={t('card.unread')} />}
          <svg className={css.rowChevron} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div id={detailsId} className={css.cardDetails} hidden={disclosure !== undefined && !disclosure.expanded}>
        {(disclosure === undefined || disclosure.expanded) && <>
          <span className={css.cardHead}>
            <span
              className={clsx(
                css.badge,
                item.waiting
                  ? css.badgeWaiting
                  : item.running
                    ? css.badgeRunning
                    : item.outcome === 'completed' ? css.badgeSuccess : css.badgeFailure,
              )}
            >
              {badge}
            </span>
            {item.unread && <span className={css.unreadDot} title={t('card.unread')} />}
            {item.pinned && <span className={css.pinMark} aria-label={t('card.pin')}>📌</span>}
            <span className={css.cardTitle} title={item.title}>{item.title}</span>
            <span className={css.cardWorkspace} title={item.workspaceTitle}>{item.workspaceTitle}</span>
          </span>
          <div className={css.cardBody} data-card-body="">
            <span className={css.fieldLabel}>{t('card.question')}</span>
            <span className={css.question}>
              {item.question === null ? t('card.noQuestion') : item.question}
              {item.questionTruncated ? '…' : ''}
            </span>
            {!item.running && (
              <>
                <span className={css.fieldLabel}>{t('card.reply')}</span>
                {item.reply === null
                  ? <span className={css.replyEmpty}>{t('card.noReply')}</span>
                  : (
                    <span className={css.reply}>
                      {item.reply}
                      {item.replyTruncated ? '…' : ''}
                    </span>
                  )}
                {item.replyTruncated && <span className={css.truncated}>{t('card.truncated')}</span>}
              </>
            )}
            {item.changedFileCount > 0 && (
              <span className={css.files} title={item.changedFiles.join('\n')}>
                {t('card.files', { count: item.changedFileCount })}
                {item.changedFiles.length > 0 && (
                  <span className={css.filesList}>
                    {item.changedFiles.map(path => path.slice(path.lastIndexOf('/') + 1)).join(' · ')}
                    {item.changedFileCount > item.changedFiles.length ? ' …' : ''}
                  </span>
                )}
              </span>
            )}
          </div>
          <span className={css.cardActions}>
            <button type="button" className={css.openSession} onClick={() => { actions.open(item) }}>
              {t('card.open')}
            </button>
            {!item.running && !item.waiting && (
              <button type="button" className={css.action} onClick={() => { actions.continueWork(item) }}>
                {t('card.continue')}
              </button>
            )}
            {!item.running && (
              <button type="button" className={css.action} onClick={() => { actions.toggleHandled(item) }}>
                {item.handled ? t('card.unhandle') : t('card.handled')}
              </button>
            )}
            <button type="button" className={css.action} onClick={() => { actions.addTodo(item) }}>
              {t('card.todo')}
            </button>
            <button type="button" className={css.action} onClick={() => { actions.togglePinned(item) }}>
              {item.pinned ? t('card.unpin') : t('card.pin')}
            </button>
            {!item.running && !item.waiting && (
              <button type="button" className={css.action} onClick={() => { actions.snoozeUntilTomorrow(item) }}>
                {t('card.snooze')}
              </button>
            )}
          </span>
        </>}
      </div>
    </article>
  )
}
