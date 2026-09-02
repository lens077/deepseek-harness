/**
 * The inbox surface over the center column: what needs the user across every
 * workspace, sectioned by why — waiting for a reply, failed, finished and
 * unread, seen but not dealt with, running — plus the todo and timeline tabs.
 *
 * The session list supplies every card's content (the digest projection rides
 * each row) and the durable inbox supplies the user's marks; the panel joins
 * them per render and never fetches a session. The keyboard ring walks the
 * inbox cards in section order so a morning of triage never needs the mouse.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxTodoId } from '@deepseek-ai/dsh-session-inbox/types'
import type { DigestPanelProps } from './contract/slots.ts'
import { InboxCard, type InboxCardActions } from './InboxCard.tsx'
import type { BriefLabels, InboxItem, InboxSectionKey, InboxWindow } from './select.ts'
import { questionSeqOf, renderBrief, selectInbox, selectTimeline, selectTodos, startOfDay } from './select.ts'
import type { InboxTab } from './stores.ts'
import { Timeline } from './Timeline.tsx'
import { TodoList } from './TodoList.tsx'
import css from './DigestPanel.module.css'

const DAY_MS = 86_400_000
/** Snoozed rows resurface at this local hour of the next day. */
const SNOOZE_HOUR = 9
/** How often the window boundaries are re-evaluated while the panel is open. */
const CLOCK_MS = 60_000
/** Longest question kept in an automatically worded todo. */
const TODO_QUESTION_CHARS = 120

const TABS: readonly InboxTab[] = ['inbox', 'todos', 'timeline']
const WINDOWS: readonly InboxWindow[] = ['sinceReview', 'today', 'week', 'all']
const SECTION_KEYS: readonly InboxSectionKey[] = ['pinned', 'needsYou', 'failed', 'unread', 'seen', 'running', 'handled']

/**
 * Whether a key event originates in an editable control, where single-letter
 * shortcuts must not fire.
 * @param target - the event target.
 * @returns true for inputs, text areas, and contenteditable hosts.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.closest('[contenteditable]') !== null
}

/**
 * Render the inbox panel, or nothing while it is closed.
 * @param props - composed slot props (store share, global hooks, inject, locale).
 * @returns the panel element, or null when closed.
 */
export function DigestPanel(props: DigestPanelProps) {
  const {
    useStore, actions, useSessions, useWorkspaces, useInbox, t,
    ensureInbox, openSession, openQuestion, continueSession, copyText,
    setHandled, snooze, setPinned, markReviewed, addTodo, updateTodo, removeTodo,
  } = props
  const open = useStore(s => s.open)
  const tab = useStore(s => s.tab)
  const window = useStore(s => s.window)
  const workspaceFilter = useStore(s => s.workspace)
  const showHandled = useStore(s => s.showHandled)
  const rows = useSessions(s => s.ids.map(id => s.byId[id]).filter(row => row !== undefined))
  const currentSessionId = useSessions(s => s.current)
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const inboxStatus = useInbox(v => v.status)
  const inboxError = useInbox(v => v.error)
  const inbox = useInbox(v => v.snapshot)

  const [now, setNow] = useState(() => Date.now())
  const [focus, setFocus] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void ensureInbox()
    setNow(Date.now())
    const timer = globalThis.setInterval(() => { setNow(Date.now()) }, CLOCK_MS)
    return () => { globalThis.clearInterval(timer) }
  }, [open, ensureInbox])

  useEffect(() => {
    if (notice === null) return
    const timer = globalThis.setTimeout(() => { setNotice(null) }, 2_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [notice])

  const visibleRows = useMemo(() => {
    const hidden = new Set(archived)
    return rows.filter(row => !hidden.has(row.id))
  }, [rows, archived])

  const ungroupedLabel = t('panel.ungrouped')
  const selection = useMemo(
    () => selectInbox(visibleRows, workspaces, inbox, {
      now, window, workspace: workspaceFilter, showHandled, ungroupedLabel,
    }),
    [visibleRows, workspaces, inbox, now, window, workspaceFilter, showHandled, ungroupedLabel],
  )
  const ring = useMemo(() => selection.sections.flatMap(section => section.items), [selection])
  const todos = useMemo(() => selectTodos(inbox, visibleRows, workspaces, ungroupedLabel), [inbox, visibleRows, workspaces, ungroupedLabel])
  // Pinned rows keep their category, so the ring alone yields every failed row.
  const autoTodos = useMemo(() => ring.filter(item => item.category === 'failed'), [ring])
  const timeline = useMemo(
    () => selectTimeline(visibleRows, workspaces, selection.since, ungroupedLabel),
    [visibleRows, workspaces, selection.since, ungroupedLabel],
  )

  useEffect(() => {
    if (focus >= ring.length) setFocus(Math.max(0, ring.length - 1))
  }, [ring.length, focus])

  const cardActions = useMemo<InboxCardActions>(() => ({
    open: (item) => {
      actions.close()
      openSession(item.sessionId)
    },
    continueWork: (item) => {
      actions.close()
      continueSession(item.sessionId, [t('continue.prefill'), item.question].filter(line => line !== null).join('\n'))
    },
    toggleHandled: (item) => { void setHandled(item.sessionId, !item.handled) },
    addTodo: (item) => {
      const question = (item.question ?? item.title).replace(/\s+/gu, ' ').trim()
      const text = t('todo.auto', {
        question: question.length > TODO_QUESTION_CHARS ? `${question.slice(0, TODO_QUESTION_CHARS)}…` : question,
      })
      void addTodo({ sessionId: item.sessionId, questionSeq: item.questionSeq, text })
        .then((result) => { if (result.ok) actions.setTab('todos') })
    },
    togglePinned: (item) => { void setPinned(item.sessionId, !item.pinned) },
    snoozeUntilTomorrow: (item) => {
      void snooze(item.sessionId, startOfDay(Date.now()) + DAY_MS + SNOOZE_HOUR * 3_600_000)
    },
  }), [actions, openSession, continueSession, setHandled, addTodo, setPinned, snooze, t])

  const focusCard = useCallback((index: number, item: InboxItem) => {
    setFocus(index)
    for (const card of document.querySelectorAll<HTMLElement>('[data-digest-panel] [data-session-id]')) {
      if (card.dataset['sessionId'] !== item.sessionId) continue
      card.scrollIntoView({ block: 'nearest' })
      return
    }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'inbox') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return
      if (event.key === 'Escape') {
        actions.close()
        event.preventDefault()
        return
      }
      const item = ring[focus]
      if (item === undefined) return
      const step = (next: number): void => {
        // `next` is clamped into the ring, so the lookup cannot miss.
        const target = ring[next] as InboxItem
        focusCard(next, target)
      }
      switch (event.key) {
        case 'j': case 'ArrowDown':
          step(Math.min(ring.length - 1, focus + 1))
          break
        case 'k': case 'ArrowUp':
          step(Math.max(0, focus - 1))
          break
        case 'Enter':
          cardActions.open(item)
          break
        case 'e':
          if (!item.running) cardActions.toggleHandled(item)
          break
        case 't':
          cardActions.addTodo(item)
          break
        case 'p':
          cardActions.togglePinned(item)
          break
        case 's':
          if (!item.running && !item.waiting) cardActions.snoozeUntilTomorrow(item)
          break
        default:
          return
      }
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, tab, ring, focus, focusCard, cardActions, actions])

  const copyBrief = useCallback(() => {
    const labels: BriefLabels = {
      title: `${t('brief.title')} ${new Date(now).toLocaleDateString()}`,
      since: t('brief.since'),
      sections: Object.fromEntries(SECTION_KEYS.map(key => [key, t(`section.${key}`)])) as Record<InboxSectionKey, string>,
      outcomes: {
        completed: t('outcome.completed'),
        error: t('outcome.error'),
        aborted: t('outcome.aborted'),
        blocked: t('outcome.blocked'),
        'max-tokens': t('outcome.max-tokens'),
        interrupted: t('outcome.interrupted'),
        open: t('outcome.open'),
      },
      files: count => t('card.files', { count }),
      todos: t('brief.todos'),
      none: t('brief.none'),
    }
    const text = renderBrief(selection, todos, labels, at => new Date(at).toLocaleString())
    void copyText(text).then((ok) => { setNotice(ok ? t('panel.copied') : t('panel.copyFailed')) })
  }, [selection, todos, t, now, copyText])

  // Closed is the common case; rendering nothing keeps the center-column
  // overlay pointer-transparent so the conversation stays fully interactive.
  if (!open) return null

  const continueFromTodo = (id: SessionId, hint: string | null): void => {
    actions.close()
    continueSession(id, hint === null ? t('continue.prefill') : `${t('continue.prefill')}\n${hint}`)
  }
  const openAt = (id: SessionId, seq: number): void => {
    actions.close()
    openQuestion(id, seq)
  }

  return (
    <div className={css.panel} role="region" aria-label={t('panel.title')} data-digest-panel="">
      <header className={css.header}>
        <h2 className={css.title}>{t('panel.title')}</h2>
        <span className={css.tabs} role="tablist">
          {TABS.map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              className={clsx(css.tab, tab === key && css.tabActive)}
              aria-selected={tab === key}
              onClick={() => { actions.setTab(key) }}
            >
              {t(`tab.${key}`)}
              {key === 'inbox' && selection.attentionCount > 0 && (
                <span className={clsx(css.tabCount, selection.waitingCount > 0 && css.tabCountUrgent)}>{selection.attentionCount}</span>
              )}
              {key === 'todos' && todos.some(row => row.todo.status === 'open') && (
                <span className={css.tabCount}>{todos.filter(row => row.todo.status === 'open').length}</span>
              )}
            </button>
          ))}
        </span>
        <span className={css.spacer} />
        {notice !== null && <span className={css.notice} role="status">{notice}</span>}
        <button type="button" className={css.headerAction} onClick={copyBrief}>{t('panel.copyBrief')}</button>
        <button
          type="button"
          className={css.headerAction}
          title={t('panel.markReviewed.hint')}
          onClick={() => { void markReviewed() }}
        >
          {t('panel.markReviewed')}
        </button>
        <button
          type="button"
          className={css.close}
          aria-label={t('panel.close')}
          onClick={() => { actions.close() }}
        >
          <IconCloseOutline16 size={16} />
        </button>
      </header>

      <div className={css.toolbar}>
        <span className={css.groupToggle} role="group">
          {WINDOWS.map(key => (
            <button
              key={key}
              type="button"
              className={clsx(css.groupButton, window === key && css.groupActive)}
              aria-pressed={window === key}
              onClick={() => { actions.setWindow(key) }}
            >
              {t(`window.${key}`)}
            </button>
          ))}
        </span>
        {selection.since !== null && (
          <span className={css.since}>{t('panel.since', { time: new Date(selection.since).toLocaleString() })}</span>
        )}
        <span className={css.counts}>
          <span className={css.countEnded}>{t('panel.attention', { count: selection.attentionCount })}</span>
          {selection.runningCount > 0 && (
            <span className={css.countRunning}>{t('panel.running', { count: selection.runningCount })}</span>
          )}
          {selection.snoozedCount > 0 && (
            <span className={css.countRunning}>{t('panel.snoozed', { count: selection.snoozedCount })}</span>
          )}
        </span>
        <span className={css.spacer} />
        <label className={css.showHandled}>
          <input type="checkbox" checked={showHandled} onChange={() => { actions.toggleShowHandled() }} />
          {t('panel.showHandled')}
        </label>
      </div>

      {selection.workspaces.length > 1 && (
        <div className={css.chips} role="group">
          <button
            type="button"
            className={clsx(css.chip, workspaceFilter === undefined && css.chipActive)}
            aria-pressed={workspaceFilter === undefined}
            onClick={() => { actions.setWorkspace(undefined) }}
          >
            {t('panel.allWorkspaces')}
          </button>
          {selection.workspaces.map(count => (
            <button
              key={count.workspaceId ?? '__ungrouped__'}
              type="button"
              className={clsx(css.chip, workspaceFilter === count.workspaceId && css.chipActive)}
              aria-pressed={workspaceFilter === count.workspaceId}
              onClick={() => { actions.setWorkspace(count.workspaceId) }}
            >
              {count.title}
              {count.attention > 0 && <span className={css.chipCount}>{count.attention}</span>}
              {count.running > 0 && <span className={css.chipRunning}>{count.running}</span>}
            </button>
          ))}
        </div>
      )}

      {inboxStatus === 'error' && (
        <div className={css.errorBar} role="alert">
          {t('panel.error', { message: inboxError ?? '' })}
          <button type="button" className={css.action} onClick={() => { void ensureInbox() }}>{t('panel.retry')}</button>
        </div>
      )}

      <div className={css.body}>
        {tab === 'inbox' && (
          selection.sections.length === 0
            ? (
              <div className={css.empty}>
                <p className={css.emptyTitle}>{inboxStatus === 'loading' ? t('panel.loading') : t('panel.empty.title')}</p>
                <p className={css.emptyBody}>{t('panel.empty.body')}</p>
              </div>
            )
            : (
              <>
                {selection.sections.map(section => (
                  <section key={section.key} className={css.section} data-section={section.key}>
                    <h3 className={css.sectionLabel}>
                      {t(`section.${section.key}`)}
                      <span className={css.sectionCount}>{section.items.length}</span>
                    </h3>
                    <div className={css.grid}>
                      {section.items.map(item => (
                        <InboxCard
                          key={item.sessionId}
                          item={item}
                          focused={ring[focus]?.sessionId === item.sessionId}
                          t={t}
                          actions={cardActions}
                        />
                      ))}
                    </div>
                  </section>
                ))}
                <p className={css.keys}>{t('panel.keys')}</p>
              </>
            )
        )}
        {tab === 'todos' && (
          <TodoList
            rows={todos}
            auto={autoTodos}
            currentSessionId={currentSessionId}
            t={t}
            actions={{
              openSession: (id) => {
                actions.close()
                openSession(id)
              },
              openQuestion: openAt,
              continueWork: continueFromTodo,
              add: async (sessionId, text) => {
                const result = await addTodo({
                  sessionId,
                  questionSeq: questionSeqOf(visibleRows.find(row => row.id === sessionId)),
                  text,
                })
                return result.ok
              },
              setStatus: (id: InboxTodoId, done) => { void updateTodo(id, { status: done ? 'done' : 'open' }) },
              remove: (id) => { void removeTodo(id) },
              markHandled: (id) => { void setHandled(id, true) },
            }}
          />
        )}
        {tab === 'timeline' && (
          <Timeline days={timeline} now={now} t={t} openQuestion={openAt} />
        )}
      </div>
    </div>
  )
}
