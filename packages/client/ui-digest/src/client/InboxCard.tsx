/**
 * One inbox item as a card: status badge, session identity, the newest
 * question, the closing answer, the changed-file count, and the triage actions
 * the keyboard ring also reaches. Every action is a callback from the panel;
 * the card holds no state of its own.
 */
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
 * Render one inbox item.
 * @param props - the item, whether the keyboard ring focuses it, its localized copy, and the actions.
 * @returns the card element.
 */
export function InboxCard({ item, focused, t, actions }: {
  item: InboxItem
  focused: boolean
  t: DigestPanelProps['t']
  actions: InboxCardActions
}) {
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
      className={clsx(css.card, tone, focused && css.focused, item.unread && css.unreadCard)}
      data-session-id={item.sessionId}
      data-focused={focused ? '' : undefined}
      aria-current={focused ? 'true' : undefined}
    >
      <span className={css.cardHead}>
        <span className={clsx(css.badge, item.waiting ? css.badgeWaiting : item.outcome === 'completed' && !item.running ? css.badgeSuccess : css.badgeFailure)}>
          {badge}
        </span>
        {item.unread && <span className={css.unreadDot} title={t('card.unread')} />}
        {item.pinned && <span className={css.pinMark} aria-label={t('card.pin')}>📌</span>}
        <span className={css.cardTitle} title={item.title}>{item.title}</span>
        <span className={css.cardWorkspace} title={item.workspaceTitle}>{item.workspaceTitle}</span>
      </span>
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
    </article>
  )
}
