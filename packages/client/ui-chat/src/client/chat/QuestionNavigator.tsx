/**
 * The transcript's question rail, top to bottom: the standing entry that opens
 * the question search panel, the load-all entry that pages the whole session
 * in while earlier history is still unloaded, previous and next stepping, and
 * last the back-to-bottom entry. The rail redraws no question index of its
 * own — the panel lists only what a query returns, and every list it shows
 * says what it covers, because the loaded window is a suffix of the session
 * and a filtered suffix is never the whole answer. Load-all sits directly
 * under search because it is the remedy for that: once every page is in, the
 * list and the arrows cover every question. Before the loaded window contains
 * a question, the rail stays visible with search and stepping disabled so
 * load-all remains reachable.
 *
 * Back-to-bottom lives on this rail rather than in the scroll container so
 * every floating control shares one containing block: two anchors (a fixed
 * rail and a sticky slot inside the scroller) drift apart on narrow viewports
 * and overlapped. It stays mounted and merely disables while the reader is
 * already at the bottom, so the column never reflows.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  IconChevronDownOutline14, IconChevronUpOutline14, IconDownloadOutline16, IconLoadingOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { SearchQuestions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QuestionEntry } from './turn-summary.ts'
import { filterLoadedQuestions, resolveHits, type QuestionSearchState } from './question-search.ts'
import css from './ChatView.module.css'

function formatTime(time: number): string {
  const date = new Date(time)
  const today = new Date()
  const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (date.toDateString() === today.toDateString()) return clock
  const day = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit' }).format(date).replace('/', '-')
  return `${day} ${clock}`
}

/** Typing pause before one whole-session search is issued. */
const SEARCH_DEBOUNCE_MS = 200

export function QuestionNavigator({
  questions, current, hasMore, loadingAll, onPrevious, onNext, onSelect, onSelectSeq, onLoadAll, searchQuestions,
  atBottom = false, onToBottom, t,
}: {
  questions: readonly QuestionEntry[]
  current: number
  hasMore: boolean
  /** Whether a load-all request is still paging earlier history in. */
  loadingAll: boolean
  onPrevious: () => void
  onNext: () => void
  onSelect: (index: number) => void
  /** Jump to a question addressed by seq, paging the window back when it sits outside. */
  onSelectSeq: (seq: number) => void
  /** Page the whole session in, so the list and the stepping arrows cover every question. */
  onLoadAll: () => void
  /**
   * Whole-session question search. Absent when no host search is composed in,
   * which is what forces the panel to admit it filtered only the window.
   */
  searchQuestions?: SearchQuestions | undefined
  /** Whether the transcript already sits at its bottom: the entry then greys out instead of leaving. */
  atBottom?: boolean
  /** Scroll the transcript to its bottom. Absent when the rail has no scroller to drive (bare tests). */
  onToBottom?: (() => void) | undefined
  t: ChatViewSlotProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<QuestionSearchState>({ kind: 'idle' })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const trimmed = query.trim()

  // The loaded window is a suffix of the session, so filtering it is only ever
  // a partial answer. It stays the immediate feedback while a host search runs,
  // and becomes the displayed answer only when no host search is composed in.
  const local = useMemo(() => filterLoadedQuestions(questions, query), [query, questions])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('pointerdown', onPointer) }
  }, [open])

  useEffect(() => {
    if (!open || trimmed === '') {
      setRemote({ kind: 'idle' })
      return
    }
    if (searchQuestions === undefined) {
      setRemote({ kind: 'window-only' })
      return
    }
    const controller = new AbortController()
    setRemote({ kind: 'searching' })
    const timer = window.setTimeout(() => {
      searchQuestions(trimmed, controller.signal).then((page) => {
        if (controller.signal.aborted) return
        setRemote({ kind: 'resolved', hits: resolveHits(page, questions), complete: page.complete })
      }, () => {
        if (controller.signal.aborted) return
        // A failed search must not degrade into an empty result: an empty list
        // reads as "no question matches", which is not what happened.
        setRemote({ kind: 'failed' })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, questions, searchQuestions, trimmed])

  const hasQuestions = questions.length > 0

  // A complete lone question has nowhere to step or search, so the question
  // controls leave. An incomplete window keeps them mounted even before its
  // first question so load-all remains reachable. Back-to-bottom is
  // independent of all that: it stays as long as there is a scroller to drive.
  const stepping = questions.length > 1 || hasMore || loadingAll
  if (!stepping && onToBottom === undefined) return null

  // Which rows to show, and what the view is entitled to claim about them.
  // `notice` is non-null exactly when the list on screen is not the whole
  // truth, so an empty list is never left to speak for the session by itself.
  const searching = remote.kind === 'searching'
  const rows = remote.kind === 'resolved' ? remote.hits : local
  const notice = ((): string | null => {
    if (trimmed === '') return hasMore ? t('chat.questions.windowOnlyIdle') : null
    switch (remote.kind) {
      case 'searching':
        return t('chat.questions.searching')
      case 'failed':
        return t('chat.questions.searchFailed')
      case 'resolved':
        if (!remote.complete) return t('chat.questions.searchPartial')
        return remote.hits.length === 0 ? t('chat.questions.searchEmpty') : null
      // Only the loaded window was filtered, so "no match" is not knowable.
      case 'window-only':
      case 'idle':
        return hasMore ? t('chat.questions.windowOnly') : null
      default:
        return null
    }
  })()

  return (
    <div className={css.questionNavigator} ref={panelRef}>
      {stepping && open && (
        <div className={css.questionPanel} id={panelId} role="dialog" aria-label={t('chat.questions.history')}>
          <label className={css.questionSearch}>
            <IconSearchOutline16 aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
              placeholder={t('chat.questions.search')}
              aria-label={t('chat.questions.search')}
            />
          </label>
          {notice !== null && (
            <p className={css.questionSearchNotice} role="status" aria-live="polite">{notice}</p>
          )}
          <div className={css.questionList} aria-busy={searching || undefined}>
            {rows.map(row => (
              <button
                key={row.seq}
                type="button"
                className={css.questionRow}
                data-current={row.index === current || undefined}
                title={row.text}
                onClick={() => {
                  if (row.index === undefined) onSelectSeq(row.seq)
                  else onSelect(row.index)
                }}
              >
                <span className={css.questionNumber}>{row.index === undefined ? '·' : row.index + 1}</span>
                <span className={css.questionCopy}>
                  <span>{row.text}</span>
                  <time dateTime={new Date(row.time).toISOString()}>{formatTime(row.time)}</time>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {stepping && (
        <>
          {/* Searching history is a standing entry above the arrows, the one
              control the rail's reduction to stepping left room for: it opens a
              list only on request, so nothing is redrawn while the reader steps. */}
          <button
            type="button"
            className={css.questionSearchEntry}
            data-panel-open={open || undefined}
            disabled={!hasQuestions}
            aria-label={t('chat.questions.search')}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconSearchOutline16 />
          </button>
          {/* The remedy sits under the search it serves: while earlier pages are
              unloaded, one press pages the whole session in, after which the
              list and the stepping arrows cover every question. The entry leaves
              with the last page, so its presence alone says the window is partial. */}
          {(hasMore || loadingAll) && (
            <button
              type="button"
              className={css.questionLoadAll}
              disabled={loadingAll}
              aria-busy={loadingAll || undefined}
              aria-label={loadingAll ? t('chat.questions.loadingAll') : t('chat.questions.loadAll')}
              onClick={onLoadAll}
            >
              {loadingAll ? <IconLoadingOutline16 className={css.questionLoadAllSpinner} /> : <IconDownloadOutline16 />}
            </button>
          )}
          <button type="button" className={css.questionArrow} disabled={!hasQuestions || (current <= 0 && !hasMore)} aria-label={t('chat.questions.previous')} onClick={onPrevious}>
            <IconChevronUpOutline14 />
          </button>
          <button type="button" className={css.questionArrow} disabled={!hasQuestions || current >= questions.length - 1} aria-label={t('chat.questions.next')} onClick={onNext}>
            <IconChevronDownOutline14 />
          </button>
        </>
      )}
      {/* Back-to-bottom closes the column. It never unmounts: a control that
          appears and vanishes with scroll position makes the rail jump under
          the pointer, so at the bottom it merely greys out like a spent arrow. */}
      {onToBottom !== undefined && (
        <button
          type="button"
          className={`${css.questionArrow} ${css.questionToBottom}`}
          disabled={atBottom}
          aria-label={t('chat.toBottom')}
          onClick={onToBottom}
        >
          <IconChevronDownOutline14 />
        </button>
      )}
    </div>
  )
}
