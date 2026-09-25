/**
 * Inbox cards show the newest question, live work or closing answer, changed
 * files, and triage actions. Phone rows disclose those details on demand; the panel owns
 * expansion and every action. Desktop buttons always show their digit key;
 * keyboard actions target only the selected card.
 */
import { useId } from 'react'
import clsx from 'clsx'
import type { CardAction } from '../nav-settings.ts'
import { CARD_ACTION_KEYS } from './card-keys.ts'
import type { DigestPanelProps } from './contract/slots.ts'
import type { InboxItem } from './select.ts'
import { RunningWork } from './RunningWork.tsx'
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
 * @param props - the item, keyboard focus, localized copy, actions, pinning and reply visibility, and phone expansion.
 * @returns the card element.
 */
export function InboxCard({ item, focused, t, actions, pinning, showReply, disclosure }: {
  item: InboxItem
  focused: boolean
  t: DigestPanelProps['t']
  actions: InboxCardActions
  /** Whether the pin action is offered; the pinned marker follows the mark regardless. */
  pinning: boolean
  /**
   * Whether the closing reply is shown. Off clamps the question to two lines
   * and drops the reply and its truncation hint so a card is a few lines
   * tall; the head, changed files, and actions stay.
   */
  showReply: boolean
  disclosure?: { expanded: boolean; toggle: () => void } | undefined
}) {
  const detailsId = useId()
  // Phone rows have no keyboard ring, so they never draw a keycap.
  const key = (action: CardAction) => disclosure === undefined
    ? <kbd className={css.keycap} aria-hidden="true">{CARD_ACTION_KEYS[action]}</kbd>
    : null
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
          <div className={clsx(css.cardBody, !item.running && !showReply && css.cardBodyBrief)} data-card-body="">
            <span className={css.fieldLabel}>{t('card.question')}</span>
            <span
              className={clsx(css.question, (item.running || !showReply) && css.questionBrief)}
              title={(!item.running && showReply) || item.question === null ? undefined : item.question}
            >
              {item.question === null ? t('card.noQuestion') : item.question}
              {item.questionTruncated ? '…' : ''}
            </span>
            {item.running && <RunningWork item={item} t={t} />}
            {!item.running && showReply && (
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
          <span className={css.cardActions} data-card-actions="">
            <button type="button" className={css.openSession} onClick={() => { actions.open(item) }}>
              {key('open')}{t('card.open')}
            </button>
            {!item.running && !item.waiting && (
              <button type="button" className={css.action} onClick={() => { actions.continueWork(item) }}>
                {key('continue')}{t('card.continue')}
              </button>
            )}
            {!item.running && (
              <button type="button" className={css.action} onClick={() => { actions.toggleHandled(item) }}>
                {key('handled')}{item.handled ? t('card.unhandle') : t('card.handled')}
              </button>
            )}
            <button type="button" className={css.action} onClick={() => { actions.addTodo(item) }}>
              {key('todo')}{t('card.todo')}
            </button>
            {pinning && (
              <button type="button" className={css.action} onClick={() => { actions.togglePinned(item) }}>
                {key('pin')}{item.pinned ? t('card.unpin') : t('card.pin')}
              </button>
            )}
            {!item.running && !item.waiting && (
              <button type="button" className={css.action} onClick={() => { actions.snoozeUntilTomorrow(item) }}>
                {key('snooze')}{t('card.snooze')}
              </button>
            )}
          </span>
        </>}
      </div>
    </article>
  )
}
