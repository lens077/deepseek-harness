/**
 * The inbox surface over the center column: what needs the user across every
 * workspace, sectioned by why — finished, seen but not dealt with, running,
 * waiting for a reply, failed — plus the todo, project todo, and timeline
 * tabs. Desktop sections and board columns admit only populated states;
 * a sole state uses the full card grid. Closing replies can be hidden without
 * hiding running-work facts.
 *
 * The session list supplies every card's content (the digest projection rides
 * each row) and the durable inbox supplies the user's marks; the panel joins
 * them per render and never fetches a session. The keyboard ring walks the
 * inbox cards in section order, or column by column on the board, the arrow
 * keys move along the row or column on screen, Tab jumps between sections
 * or columns, and the digit keys press the focused card's buttons, so a
 * morning of triage never needs the mouse.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InboxTodoId } from '@deepseek-ai/dsh-session-inbox/types'
import type { DigestPanelProps } from './contract/slots.ts'
import { InboxCard, type InboxCardActions } from './InboxCard.tsx'
import { WorkspaceFilter } from './WorkspaceFilter.tsx'
import { workspaceRowsOf } from './workspace-layout.ts'
import { cardColumnsOf } from './card-layout.ts'
import type { BriefLabels, InboxItem, InboxSectionKey, InboxWindow } from './select.ts'
import { questionSeqOf, renderBrief, selectColumns, selectInbox, selectTimeline, selectTodos, startOfDay } from './select.ts'
import type { InboxLayout, InboxTab } from './stores.ts'
import type { CardAction } from '../nav-settings.ts'
import { cardActionAvailable, cardActionOfKey, neighborCard, type CardBox, type Direction } from './card-keys.ts'
import { ProjectTodos, type ProjectTodosActions } from './ProjectTodos.tsx'
import { Timeline } from './Timeline.tsx'
import { TodoList } from './TodoList.tsx'
import { isEditableTarget } from './editable-target.ts'
import css from './DigestPanel.module.css'

const DAY_MS = 86_400_000
/** Snoozed rows resurface at this local hour of the next day. */
const SNOOZE_HOUR = 9
/** How often the window boundaries are re-evaluated while the panel is open. */
const CLOCK_MS = 60_000
/** Longest question kept in an automatically worded todo. */
const TODO_QUESTION_CHARS = 120

const TAB_KEYS: readonly InboxTab[] = ['inbox', 'todos', 'projects', 'timeline']
const WINDOWS: readonly InboxWindow[] = ['sinceReview', 'today', 'week', 'all']
const SECTION_KEYS: readonly InboxSectionKey[] = ['pinned', 'unread', 'seen', 'running', 'needsYou', 'failed', 'handled']
const LAYOUTS: readonly InboxLayout[] = ['sections', 'columns']
const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/* v8 ignore next 3 -- closed-union backstop; only reached if the action is forged */
function assertNever(value: never): never {
  throw new Error(`unknown card action: ${String(value)}`)
}

/**
 * The visible cards' boxes in viewport pixels, for the arrow keys.
 * @returns one box per card, in document order.
 */
function cardBoxes(): CardBox[] {
  return [...document.querySelectorAll<HTMLElement>('[data-digest-panel] [data-session-id]')].map((card) => {
    const rect = card.getBoundingClientRect()
    return { sessionId: card.dataset['sessionId'] as string, x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  })
}

/**
 * Render the inbox panel, or nothing while it is closed.
 * @param props - composed slot props (store share, global hooks, inject, locale).
 * @returns the panel element, or null when closed.
 */
export function DigestPanel(props: DigestPanelProps) {
  const {
    useStore, actions, useSessions, useWorkspaces, useSessionPendingInteraction, useInbox, useProjects, useNavSettings, usePinsSettings, t,
    ensureInbox, openSession, openQuestion, continueSession, copyText,
    setHandled, snooze, setPinned, markReviewed, addTodo, fileTodo, updateTodo, removeTodo,
    ensureProjects, rescanProjects, readProjectDocument, openProject, openPath, mobileView, navigateMobile,
  } = props
  const storedOpen = useStore(s => s.open)
  const mobilePending = mobileView === 'pending'
  const open = mobileView === undefined ? storedOpen : mobileView === 'overview' || mobilePending
  const closePanel = useCallback(() => {
    actions.close()
    navigateMobile?.('conversation')
  }, [actions, navigateMobile])
  const storedTab = useStore(s => s.tab)
  const [mobileTab, setMobileTab] = useState<InboxTab>('inbox')
  const [runningOnly, setRunningOnly] = useState(false)
  const [expandedSession, setExpandedSession] = useState<SessionId | null>(null)
  const tab = mobileView === undefined ? storedTab : mobileTab
  const window = useStore(s => s.window)
  const workspaceFilter = useStore(s => s.workspace)
  const showHandled = useStore(s => s.showHandled)
  const layout = useStore(s => s.layout)
  const showReply = useStore(s => s.showReply)
  const workspaceRows = useStore(s => workspaceRowsOf(s.workspaceRows))
  const cardColumns = useStore(s => cardColumnsOf(s.cardColumns))
  // The board is a desktop arrangement: phones list one column of rows anyway.
  const board = mobileView === undefined && layout === 'columns'
  const rows = useSessions(s => s.ids.map(id => s.byId[id]).filter(row => row !== undefined))
  const currentSessionId = useSessions(s => s.current)
  const jobsBySession = useSessions(s => s.jobsBySession)
  const pending = useSessionPendingInteraction(value => value)
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const inboxStatus = useInbox(v => v.status)
  const inboxError = useInbox(v => v.error)
  const inbox = useInbox(v => v.snapshot)
  const projectsView = useProjects(v => v)
  const toggleShortcut = useNavSettings(v => v.toggleShortcut)
  const enterAction = useNavSettings(v => v.enterAction)
  // The master switch hides the card's pin action and its key; the section
  // switch only changes where a pinned row is listed.
  const pinning = usePinsSettings(v => v.enabled)
  const pinnedSection = usePinsSettings(v => v.enabled && v.digestSection)

  const panelRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const [focusedSession, setFocusedSession] = useState<SessionId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void ensureInbox()
    setNow(Date.now())
    const timer = globalThis.setInterval(() => { setNow(Date.now()) }, CLOCK_MS)
    return () => { globalThis.clearInterval(timer) }
  }, [open, ensureInbox])

  // The scan is read the first time the tab shows, never for a user who
  // keeps to the inbox.
  useEffect(() => {
    if (open && tab === 'projects') void ensureProjects()
  }, [open, tab, ensureProjects])

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
      now, window: mobilePending ? 'all' : window,
      workspace: mobilePending ? undefined : workspaceFilter, showHandled: mobilePending ? false : showHandled, ungroupedLabel,
      pendingSessionIds: new Set(pending.keys()),
      jobsBySession,
      pinnedSection,
    }),
    [visibleRows, workspaces, inbox, pending, jobsBySession, now, window, workspaceFilter, showHandled,
      ungroupedLabel, mobilePending, pinnedSection],
  )
  const sections = useMemo(() => {
    if (mobileView === 'overview') {
      const ordered = [...selection.sections].sort((a, b) => Number(b.key === 'running') - Number(a.key === 'running'))
      return runningOnly ? ordered.filter(section => section.key === 'running') : ordered
    }
    if (!mobilePending) return selection.sections
    const items = selection.sections.flatMap(section => section.items)
    return (['needsYou', 'unread'] as const).map(key => ({
      key, items: items.filter(item => item.category === key),
    }))
  }, [selection, mobilePending, mobileView, runningOnly])
  const columns = useMemo(() => selectColumns(sections), [sections])
  // The ring walks whatever the user sees: sections top to bottom, or the
  // board column by column, left to right; Tab jumps between those groups.
  const groups = board ? columns : sections
  const ring = useMemo(() => groups.flatMap(group => group.items), [groups])
  const focus = Math.max(0, ring.findIndex(item => item.sessionId === focusedSession))
  const todos = useMemo(() => selectTodos(inbox, visibleRows, workspaces, ungroupedLabel), [inbox, visibleRows, workspaces, ungroupedLabel])
  // Pinned rows keep their category, so the ring alone yields every failed row.
  const autoTodos = useMemo(() => ring.filter(item => item.category === 'failed'), [ring])
  const timeline = useMemo(
    () => selectTimeline(visibleRows, workspaces, selection.since, ungroupedLabel),
    [visibleRows, workspaces, selection.since, ungroupedLabel],
  )

  useEffect(() => {
    if (!ring.some(item => item.sessionId === focusedSession)) setFocusedSession(ring[0]?.sessionId ?? null)
  }, [ring, focusedSession])

  const cardActions = useMemo<InboxCardActions>(() => ({
    open: (item) => {
      closePanel()
      openSession(item.sessionId)
    },
    continueWork: (item) => {
      closePanel()
      continueSession(item.sessionId, [t('continue.prefill'), item.question].filter(line => line !== null).join('\n'))
    },
    toggleHandled: (item) => { void setHandled(item.sessionId, !item.handled) },
    // The card moves its row to the todo list: one todo per question, and the
    // row leaves the inbox as handled once the todo exists.
    addTodo: (item) => {
      const question = (item.question ?? item.title).replace(/\s+/gu, ' ').trim()
      const text = t('todo.auto', {
        question: question.length > TODO_QUESTION_CHARS ? `${question.slice(0, TODO_QUESTION_CHARS)}…` : question,
      })
      void fileTodo({ sessionId: item.sessionId, questionSeq: item.questionSeq, text })
        .then((result) => { if (result.ok) { actions.setTab('todos'); setMobileTab('todos') } })
    },
    togglePinned: (item) => { void setPinned(item.sessionId, !item.pinned) },
    snoozeUntilTomorrow: (item) => {
      void snooze(item.sessionId, startOfDay(Date.now()) + DAY_MS + SNOOZE_HOUR * 3_600_000)
    },
  }), [actions, closePanel, openSession, continueSession, setHandled, fileTodo, setPinned, snooze, t])

  const projectActions = useMemo<ProjectTodosActions>(() => ({
    rescan: () => { void rescanProjects() },
    openProject: async (project, file) => {
      const result = await openProject(project.path, t('projects.sessionPrefill', { file: file.relativePath }))
      if (result.ok) {
        closePanel()
        return null
      }
      return t('projects.openFailed', { message: result.error.message })
    },
    openPath: async (path) => {
      const result = await openPath(path)
      return result.ok ? null : t('projects.openFailed', { message: result.error.message })
    },
    readDocument: readProjectDocument,
  }), [rescanProjects, openProject, openPath, readProjectDocument, closePanel, t])

  const focusCard = useCallback((item: InboxItem) => {
    setFocusedSession(item.sessionId)
    for (const card of document.querySelectorAll<HTMLElement>('[data-digest-panel] [data-session-id]')) {
      if (card.dataset['sessionId'] !== item.sessionId) continue
      card.scrollIntoView({ block: 'nearest' })
      return
    }
  }, [])

  const runCardAction = useCallback((action: CardAction, item: InboxItem): void => {
    switch (action) {
      case 'open': cardActions.open(item); break
      case 'continue': cardActions.continueWork(item); break
      case 'handled': cardActions.toggleHandled(item); break
      case 'todo': cardActions.addTodo(item); break
      case 'pin': cardActions.togglePinned(item); break
      case 'snooze': cardActions.snoozeUntilTomorrow(item); break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default: assertNever(action)
    }
  }, [cardActions])

  useEffect(() => {
    if (!open || tab !== 'inbox') return
    // The digit keys are claimed by the sidebar's pinned area on the same
    // document, so they are taken in the capture phase while the panel is
    // open; every other key waits for the bubble phase so a control closer
    // to the press (a menu, a dialog) still sees it first.
    const onKey = (event: KeyboardEvent, capturing: boolean): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
      if (mobileView !== undefined) return
      const digitAction = cardActionOfKey(event.key)
      if ((digitAction !== null) !== capturing) return
      if (event.key === 'Escape') {
        closePanel()
        event.preventDefault()
        return
      }
      if (event.target instanceof HTMLElement && event.target.closest('button, a[href], summary, [role="button"], [role="tab"]') !== null) return
      const item = ring[focus]
      if (item === undefined) return
      const step = (next: number): void => {
        // `next` is clamped into the ring, so the lookup cannot miss.
        const target = ring[next] as InboxItem
        focusCard(target)
      }
      const stepTo = (sessionId: string): void => {
        step(ring.findIndex(candidate => candidate.sessionId === sessionId))
      }
      const run = (action: CardAction): void => {
        runCardAction(cardActionAvailable(item, action, pinning) ? action : 'open', item)
      }
      const direction = ARROWS[event.key]
      if (direction !== undefined) {
        // Every ring item is drawn as a card, so the lookup lands.
        const boxes = cardBoxes()
        const from = boxes.find(box => box.sessionId === item.sessionId) as CardBox
        if (from.width === 0 && from.height === 0) {
          // No layout to measure (a hidden document): the ring order stands in.
          step(direction === 'down' || direction === 'right' ? Math.min(ring.length - 1, focus + 1) : Math.max(0, focus - 1))
        } else {
          const next = neighborCard(boxes, from, direction)
          if (next !== null) stepTo(next)
        }
        event.preventDefault()
        return
      }
      switch (event.key) {
        case 'j':
          step(Math.min(ring.length - 1, focus + 1))
          break
        case 'k':
          step(Math.max(0, focus - 1))
          break
        case 'Home':
          step(0)
          break
        case 'End':
          step(ring.length - 1)
          break
        case 'Tab': {
          // A focused control keeps Tab for the browser's own focus order.
          const active = document.activeElement
          if (active !== null && active !== document.body && active !== panelRef.current) return
          const populated = groups.filter(group => group.items.length > 0)
          const at = populated.findIndex(group => group.items.includes(item))
          const next = populated[at + (event.shiftKey ? -1 : 1)]
          // At either edge, native Tab can reach the toolbar and workspace controls.
          if (next === undefined) return
          stepTo((next.items[0] as InboxItem).sessionId)
          break
        }
        case 'Enter':
          run(event.shiftKey ? 'open' : enterAction)
          break
        default:
          if (digitAction === null) return
          if (!cardActionAvailable(item, digitAction, pinning)) return
          runCardAction(digitAction, item)
      }
      event.preventDefault()
    }
    const onCapture = (event: KeyboardEvent): void => { onKey(event, true) }
    const onBubble = (event: KeyboardEvent): void => { onKey(event, false) }
    document.addEventListener('keydown', onCapture, true)
    document.addEventListener('keydown', onBubble)
    return () => {
      document.removeEventListener('keydown', onCapture, true)
      document.removeEventListener('keydown', onBubble)
    }
  }, [open, tab, ring, groups, focus, focusCard, runCardAction, closePanel, mobileView, pinning, enterAction])

  // The toggle chord is pressed wherever the user is typing, so the panel
  // takes focus on open: keys then reach it rather than the covered field,
  // which gets its focus back when the panel closes.
  useEffect(() => {
    if (!open || mobileView !== undefined) return
    const previous = document.activeElement
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      const idle = document.activeElement === document.body
      if (idle && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, mobileView])

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

  const legend = t('panel.keys', { enter: t(`card.${enterAction}`), shortcut: toggleShortcut })
  const continueFromTodo = (id: SessionId, hint: string | null): void => {
    closePanel()
    continueSession(id, hint === null ? t('continue.prefill') : `${t('continue.prefill')}\n${hint}`)
  }
  const openAt = (id: SessionId, seq: number): void => {
    closePanel()
    openQuestion(id, seq)
  }

  return (
    <div ref={panelRef} tabIndex={-1} className={css.panel} role="region" aria-label={t(mobilePending ? 'mobile.pending' : mobileView === 'overview' ? 'mobile.overview' : 'panel.title')} data-digest-panel="" data-mobile-pending={mobilePending || undefined}>
      <header className={css.header}>
        <h2 className={css.title}>{t(mobilePending ? 'mobile.pending' : mobileView === 'overview' ? 'mobile.overview' : 'panel.title')}</h2>
        {!mobilePending && <span className={css.tabs} role="tablist">
          {TAB_KEYS.map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              className={clsx(css.tab, tab === key && css.tabActive)}
              aria-selected={tab === key}
              onClick={() => { if (mobileView === undefined) actions.setTab(key); else setMobileTab(key) }}
            >
              {t(`tab.${key}`)}
              {key === 'inbox' && selection.attentionCount > 0 && (
                <span className={clsx(css.tabCount, selection.waitingCount > 0 && css.tabCountUrgent)}>{selection.attentionCount}</span>
              )}
              {key === 'todos' && todos.some(row => row.todo.status === 'open') && (
                <span className={css.tabCount}>{todos.filter(row => row.todo.status === 'open').length}</span>
              )}
              {key === 'projects' && projectsView.snapshot.projects.length > 0 && (
                <span className={css.tabCount}>{projectsView.snapshot.projects.reduce((sum, project) => sum + project.open, 0)}</span>
              )}
            </button>
          ))}
        </span>}
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
          onClick={() => { closePanel() }}
        >
          <IconCloseOutline16 size={16} />
        </button>
      </header>

      {mobileView === 'overview' && (
        <div className={css.compactToolbar} data-digest-compact-toolbar="">
          <select
            className={css.compactSelect}
            aria-label={t('mobile.surface')}
            value={tab}
            onChange={(event) => { setMobileTab(event.currentTarget.value as InboxTab) }}
          >
            {TAB_KEYS.map(key => <option key={key} value={key}>{t(`tab.${key}`)}</option>)}
          </select>
          <select
            className={css.compactSelect}
            aria-label={t('mobile.window')}
            value={window}
            onChange={(event) => { actions.setWindow(event.currentTarget.value as InboxWindow) }}
          >
            {WINDOWS.map(key => <option key={key} value={key}>{t(`window.${key}`)}</option>)}
          </select>
          <details className={css.compactMore}>
            <summary aria-label={t('mobile.more')} title={t('mobile.more')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" />
              </svg>
            </summary>
            <div className={css.compactMoreBody}>
              <span className={css.countEnded}>{t('panel.attention', { count: selection.attentionCount })}</span>
              <button type="button" className={css.groupButton} aria-pressed={runningOnly}
                onClick={() => { setRunningOnly(value => !value); setMobileTab('inbox') }}>
                {t('panel.running', { count: selection.runningCount })}
              </button>
              {selection.snoozedCount > 0 && <span className={css.countRunning}>{t('panel.snoozed', { count: selection.snoozedCount })}</span>}
              <label className={css.showHandled}>
                <input type="checkbox" checked={showHandled} onChange={() => { actions.toggleShowHandled() }} />
                {t('panel.showHandled')}
              </label>
              <label className={css.showHandled}>
                <input type="checkbox" checked={showReply} onChange={() => { actions.toggleShowReply() }} />
                {t('panel.showReply')}
              </label>
              <button type="button" className={css.action} onClick={copyBrief}>{t('panel.copyBrief')}</button>
              <button type="button" className={css.action} title={t('panel.markReviewed.hint')}
                onClick={() => { void markReviewed() }}>{t('panel.markReviewed')}</button>
            </div>
          </details>
        </div>
      )}
      {mobilePending && <div className={css.toolbar} role="group" aria-label={t('mobile.pending')}>
        {(['needsYou', 'unread', 'todos'] as const).map(key => (
          <button key={key} type="button" className={css.groupButton}
            onClick={() => { document.getElementById(`digest-pending-${key}`)?.scrollIntoView({ block: 'start' }) }}>
            {t(key === 'todos' ? 'mobile.todos' : key === 'unread' ? 'mobile.unread' : 'section.needsYou')}
          </button>
        ))}
      </div>}
      {!mobilePending && <div className={clsx(css.toolbar, mobileView === 'overview' && css.overviewToolbar)}>
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
          {mobileView === 'overview' ? (
            <button type="button" className={css.groupButton} aria-pressed={runningOnly}
              onClick={() => { setRunningOnly(value => !value); setMobileTab('inbox') }}>
              {t('panel.running', { count: selection.runningCount })}
            </button>
          ) : selection.runningCount > 0 && (
            <span className={css.countRunning}>{t('panel.running', { count: selection.runningCount })}</span>
          )}
          {selection.snoozedCount > 0 && (
            <span className={css.countRunning}>{t('panel.snoozed', { count: selection.snoozedCount })}</span>
          )}
        </span>
        <span className={css.spacer} />
        <label className={css.showHandled}>
          <input type="checkbox" checked={showReply} onChange={() => { actions.toggleShowReply() }} />
          {t('panel.showReply')}
        </label>
        <label className={css.showHandled}>
          <input type="checkbox" checked={showHandled} onChange={() => { actions.toggleShowHandled() }} />
          {t('panel.showHandled')}
        </label>
        {mobileView === undefined && (
          <span className={css.groupToggle} role="group" aria-label={t('panel.layout')}>
            {LAYOUTS.map(key => (
              <button
                key={key}
                type="button"
                className={clsx(css.groupButton, layout === key && css.groupActive)}
                aria-pressed={layout === key}
                onClick={() => { actions.setLayout(key) }}
              >
                {t(`layout.${key}`)}
              </button>
            ))}
          </span>
        )}
      </div>}

      {!mobilePending && selection.workspaces.length > 1 && (
        <WorkspaceFilter
          workspaces={selection.workspaces}
          selected={workspaceFilter}
          rows={workspaceRows}
          onSelect={actions.setWorkspace}
          t={t}
        />
      )}

      {inboxStatus === 'error' && (
        <div className={css.errorBar} role="alert">
          {t('panel.error', { message: inboxError ?? '' })}
          <button type="button" className={css.action} onClick={() => { void ensureInbox() }}>{t('panel.retry')}</button>
        </div>
      )}

      <div className={css.body} data-digest-body="" style={{ '--digest-card-columns': cardColumns } as CSSProperties}>
        {(mobilePending || tab === 'inbox') && (
          sections.length === 0
            ? (
              <div className={css.empty}>
                <p className={css.emptyTitle}>{inboxStatus === 'loading' ? t('panel.loading') : t('panel.empty.title')}</p>
                <p className={css.emptyBody}>{t('panel.empty.body')}</p>
              </div>
            )
            : board
              ? (
                <div className={css.boardWrap}>
                  <div className={css.board} data-digest-board="">
                    {columns.map(column => (
                      <section key={column.key} className={css.column} data-column={column.key}>
                        <h3 className={css.sectionLabel}>
                          {t(`column.${column.key}`)}
                          <span className={css.sectionCount}>{column.items.length}</span>
                        </h3>
                        <div className={clsx(css.columnList, columns.length === 1 && [css.grid, css.columnListSingle])}>
                          {column.items.map(item => (
                            <InboxCard
                              key={item.sessionId}
                              item={item}
                              focused={ring[focus]?.sessionId === item.sessionId}
                              t={t}
                              actions={cardActions}
                              pinning={pinning}
                              showReply={showReply}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )
              : (
                <div className={clsx(css.sections, mobileView === undefined && sections.length === 1 && css.sectionsSingle)}>
                  {sections.map(section => (
                    <section key={section.key} className={css.section} data-section={section.key} id={mobilePending ? `digest-pending-${section.key}` : undefined}>
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
                            pinning={pinning}
                            showReply={showReply}
                            disclosure={mobileView === undefined ? undefined : {
                              expanded: expandedSession === item.sessionId,
                              toggle: () => { setExpandedSession(value => value === item.sessionId ? null : item.sessionId) },
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )
        )}
        {mobilePending && <h3 className={css.sectionLabel} id="digest-pending-todos">{t('mobile.todos')}</h3>}
        {(mobilePending || tab === 'todos') && (
          <TodoList
            rows={todos}
            auto={mobilePending ? [] : autoTodos}
            currentSessionId={currentSessionId}
            t={t}
            actions={{
              openSession: (id) => {
                closePanel()
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
        {!mobilePending && tab === 'projects' && (
          <ProjectTodos view={projectsView} t={t} actions={projectActions} />
        )}
        {!mobilePending && tab === 'timeline' && (
          <Timeline days={timeline} now={now} t={t} openQuestion={openAt} />
        )}
      </div>
      {mobileView === undefined && tab === 'inbox' && ring.length > 0 && <footer className={css.keys} data-digest-keys="">{legend}</footer>}
    </div>
  )
}
