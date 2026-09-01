/**
 * The transcript's question rail: previous and next stepping, plus one
 * standing entry that opens the question search panel. The rail redraws no
 * question index of its own — the panel lists only what a query returns, and
 * every list it shows says what it covers, because the loaded window is a
 * suffix of the session and a filtered suffix is never the whole answer.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  IconChevronDownOutline14, IconChevronUpOutline14, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { SearchQuestions } from '../contract/question-search.ts'
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
  questions, current, hasMore, onPrevious, onNext, onSelect, onSelectSeq, searchQuestions, t,
}: {
  questions: QuestionEntry[]
  current: number
  hasMore: boolean
  onPrevious: () => void
  onNext: () => void
  onSelect: (index: number) => void
  /** Jump to a question addressed by seq, paging the window back when it sits outside. */
  onSelectSeq: (seq: number) => void
  /**
   * Whole-session question search. Absent when no host search is composed in,
   * which is what forces the panel to admit it filtered only the window.
   */
  searchQuestions?: SearchQuestions | undefined
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

  // A lone question has nowhere to step and nothing to search among, so the
  // rail stays empty rather than showing disabled controls.
  if (questions.length <= 1) return null

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
      {open && (
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
      <button type="button" className={css.questionArrow} disabled={current <= 0 && !hasMore} aria-label={t('chat.questions.previous')} onClick={onPrevious}>
        <IconChevronUpOutline14 />
      </button>
      <button type="button" className={css.questionArrow} disabled={current >= questions.length - 1} aria-label={t('chat.questions.next')} onClick={onNext}>
        <IconChevronDownOutline14 />
      </button>
      {/* Searching history is a standing entry beside the arrows, the one
          control the rail's reduction to stepping left room for: it opens a
          list only on request, so nothing is redrawn while the reader steps. */}
      <button
        type="button"
        className={css.questionSearchEntry}
        data-panel-open={open || undefined}
        aria-label={t('chat.questions.search')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconSearchOutline16 />
      </button>
    </div>
  )
}
