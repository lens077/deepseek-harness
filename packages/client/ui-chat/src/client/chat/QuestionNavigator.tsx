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
 * Picking questions for removal works from the list itself: Cmd/Ctrl press
 * adds one row, Shift press adds every removable row between the anchor and
 * the pressed one, and merely holding Shift takes the range live so the
 * hovered row joins the picks as the pointer moves. Either gesture enters
 * selection mode, so the explicit mode toggle is a discoverable alternative
 * rather than a required first step. Escape backs out one level at a time:
 * an open range, then selection mode, then the panel.
 *
 * Removing questions from model context is confirmed in a centered modal
 * dialog over the page, not in a strip above the list: the panel opens upward
 * from the composer floor, so an inline confirmation displaces the rows it is
 * asking about. Enter confirms and Escape cancels, and the panel's
 * outside-press close is suspended while that dialog stands.
 *
 * Back-to-bottom lives on this rail rather than in the scroll container so
 * every floating control shares one containing block: two anchors (a fixed
 * rail and a sticky slot inside the scroller) drift apart on narrow viewports
 * and overlapped. It stays mounted and merely disables while the reader is
 * already at the bottom, so the column never reflows.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Button, IconCheckOutline14, IconChevronDownOutline14, IconChevronUpOutline14, IconDownloadOutline16,
  IconLoadingOutline16, IconSearchOutline16, IconTrashOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { SearchQuestions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QuestionEntry } from './turn-summary.ts'
import {
  filterLoadedQuestions, resolveHits, type QuestionSearchResultRow, type QuestionSearchState,
} from './question-search.ts'
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

/** Context-removal facts the panel needs about the loaded questions. */
export interface QuestionRemovalProps {
  /** Turn that answered each loaded question, by question key; absent when the window holds no boundary for it. */
  readonly turnOfQuestion: ReadonlyMap<string, number>
  /** Turns whose complete span may be removed now: completed, loaded, and not yet removed. */
  readonly removableTurns: ReadonlySet<number>
  /** Turns a landed removal already took out of model history. */
  readonly removedTurns: ReadonlySet<number>
  /** Remove the given completed turns from model history; rejects with a presentable message. */
  readonly onRemoveTurns: (turns: readonly number[]) => Promise<void>
}

/** One removal request the panel is confirming or running. */
type RemovalState =
  | { kind: 'idle' }
  | { kind: 'confirm'; turns: readonly number[] }
  | { kind: 'running'; turns: readonly number[] }
  | { kind: 'failed'; message: string }

const NO_REMOVAL: QuestionRemovalProps = {
  turnOfQuestion: new Map(),
  removableTurns: new Set(),
  removedTurns: new Set(),
  onRemoveTurns: () => Promise.resolve(),
}

export function QuestionNavigator({
  questions, current, hasMore, loadingAll, onPrevious, onNext, onSelect, onSelectSeq, onLoadAll, searchQuestions,
  removal = NO_REMOVAL, atBottom = false, onToBottom, onColumnHeight, t,
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
  /** Context-removal facts and command; absent when the view offers no removal (bare tests). */
  removal?: QuestionRemovalProps
  /** Whether the transcript already sits at its bottom: the entry then greys out instead of leaving. */
  atBottom?: boolean
  /** Scroll the transcript to its bottom. Absent when the rail has no scroller to drive (bare tests). */
  onToBottom?: (() => void) | undefined
  /**
   * Report this column's rendered height in CSS pixels whenever it changes, so
   * the turn rail beside it can stop short of the controls.
   */
  onColumnHeight?: ((height: number) => void) | undefined
  t: ChatViewSlotProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<QuestionSearchState>({ kind: 'idle' })
  // Multi-select lives only while the panel is open; a closed panel forgets it.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  // Seq of the last row a pick addressed: the fixed end of a Shift range.
  const [anchorSeq, setAnchorSeq] = useState<number | null>(null)
  // Row the pointer last stood on, and whether Shift is down: together they
  // are the moving end of a live range.
  const [hoverSeq, setHoverSeq] = useState<number | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [removalState, setRemovalState] = useState<RemovalState>({ kind: 'idle' })
  // Picks held before the live range started. Non-null exactly while a range
  // is open, which is what Escape can still take back; a released Shift
  // commits by dropping it.
  const rangeBase = useRef<ReadonlySet<number> | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  // The column's height moves when its entries change (load-all arriving or
  // leaving) and when the size preference changes; both are resizes of this
  // element, so one observer covers them.
  useEffect(() => {
    const column = panelRef.current
    if (column === null || onColumnHeight === undefined) return
    const publish = (): void => { onColumnHeight(column.offsetHeight) }
    publish()
    /* v8 ignore next -- jsdom lane has no ResizeObserver; the initial publish above still runs. */
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(column)
    return () => { observer.disconnect() }
  }, [onColumnHeight])
  const trimmed = query.trim()
  const { turnOfQuestion, removableTurns, removedTurns, onRemoveTurns } = removal

  // The loaded window is a suffix of the session, so filtering it is only ever
  // a partial answer. It stays the immediate feedback while a host search runs,
  // and becomes the displayed answer only when no host search is composed in.
  const local = useMemo(() => filterLoadedQuestions(questions, query), [query, questions])

  // The removal dialog is portaled to the document body, so every press inside
  // it lands outside the panel. Suspending the outside-press rule while a
  // removal is open is what lets the dialog leave the panel at all.
  const removalOpen = removalState.kind !== 'idle'
  useEffect(() => {
    if (!open || removalOpen) return
    const onPointer = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('pointerdown', onPointer) }
  }, [open, removalOpen])

  useEffect(() => {
    if (open) return
    setSelecting(false)
    setSelected(new Set())
    setAnchorSeq(null)
    setHoverSeq(null)
    setRemovalState({ kind: 'idle' })
  }, [open])

  // A turn removed elsewhere, or one whose window moved, leaves the selection.
  useEffect(() => {
    setSelected((value) => {
      const kept = [...value].filter(turn => removableTurns.has(turn))
      return kept.length === value.size ? value : new Set(kept)
    })
  }, [removableTurns])

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
  const removing = removalState.kind === 'running'
  const toggleSelected = (turn: number): void => {
    setSelected((value) => {
      const next = new Set(value)
      if (next.has(turn)) next.delete(turn)
      else next.add(turn)
      return next
    })
  }
  const requestRemoval = (turns: readonly number[]): void => {
    if (turns.length === 0 || removing) return
    setRemovalState({ kind: 'confirm', turns })
  }
  const confirmRemoval = (turns: readonly number[]): void => {
    setRemovalState({ kind: 'running', turns })
    onRemoveTurns(turns).then(() => {
      setRemovalState({ kind: 'idle' })
      setSelected(new Set())
      setSelecting(false)
      setAnchorSeq(null)
    }, (error: unknown) => {
      setRemovalState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
  }
  const closeRemoval = (): void => { setRemovalState({ kind: 'idle' }) }
  const pendingTurns = removalState.kind === 'confirm' || removalState.kind === 'running' ? removalState.turns : null
  const failureMessage = removalState.kind === 'failed' ? removalState.message : null

  // Enter answers the open question; Escape and the mask cancel it through the
  // dialog itself. A request already running answers neither, so a second
  // Enter cannot send the same removal twice.
  useEffect(() => {
    if (removalState.kind !== 'confirm') return
    const turns = removalState.turns
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      confirmRemoval(turns)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [removalState])

  const rows = remote.kind === 'resolved' ? remote.hits : local

  // A displayed row addresses a turn only while its question is loaded; an
  // out-of-window search hit addresses none, which is why it offers neither
  // removal nor a pick.
  const turnOfRow = (row: QuestionSearchResultRow): number | undefined => {
    const entry = row.index === undefined ? undefined : questions[row.index]
    return entry === undefined ? undefined : turnOfQuestion.get(entry.key)
  }
  /** The turn a displayed row may hand to a removal, by that row's seq. */
  const removableTurnOfSeq = (seq: number): number | undefined => {
    const row = rows.find(candidate => candidate.seq === seq)
    const turn = row === undefined ? undefined : turnOfRow(row)
    return turn !== undefined && removableTurns.has(turn) ? turn : undefined
  }
  /**
   * Removable turns of the displayed rows between two rows inclusive. The
   * range follows the list as it stands, so a filtered list ranges over what
   * the reader can actually see rather than over hidden history.
   */
  const rangeTurns = (fromSeq: number, toSeq: number): readonly number[] => {
    const from = rows.findIndex(row => row.seq === fromSeq)
    const to = rows.findIndex(row => row.seq === toSeq)
    if (from < 0) return []
    const [first, last] = from <= to ? [from, to] : [to, from]
    return rows.slice(first, last + 1)
      .map(turnOfRow)
      .filter((turn): turn is number => turn !== undefined && removableTurns.has(turn))
  }

  // Shift is a held state, not only a click modifier: while it is down the
  // panel tracks it so the hovered row can join the picks without a press.
  // A lost keyup (focus leaving the window mid-gesture) would strand the
  // range open, so blur releases it too.
  useEffect(() => {
    if (!open) return
    const release = (): void => { setShiftHeld(false) }
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Shift') setShiftHeld(true) }
    const onKeyUp = (event: KeyboardEvent): void => { if (event.key === 'Shift') release() }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
      release()
    }
  }, [open])

  // Holding Shift over a row takes the range live: the hovered row and every
  // removable row back to the anchor join the picks as the pointer moves,
  // recomputed from the picks held when the gesture started so the range
  // shrinks as readily as it grows. Releasing Shift commits it by forgetting
  // that starting point.
  useEffect(() => {
    if (!shiftHeld) {
      rangeBase.current = null
      return
    }
    if (hoverSeq === null) return
    const hovered = removableTurnOfSeq(hoverSeq)
    if (hovered === undefined) return
    // The row under the pointer when the gesture opens is its fixed end when
    // no reachable anchor exists yet; without this the sweep would range from
    // nothing and collapse to the hovered row alone at every move.
    const anchorReachable = anchorSeq !== null && rows.some(row => row.seq === anchorSeq)
    const from = anchorReachable ? anchorSeq : hoverSeq
    if (!anchorReachable && rangeBase.current === null) setAnchorSeq(hoverSeq)
    setSelecting(true)
    setSelected((value) => {
      const base = rangeBase.current ?? value
      rangeBase.current = base
      const range = rangeTurns(from, hoverSeq)
      return new Set([...base, ...(range.length > 0 ? range : [hovered])])
    })
  }, [anchorSeq, hoverSeq, shiftHeld])

  // Escape backs out one level at a time: it cancels an open range, then
  // leaves selection mode, and only then closes the panel. While the removal
  // dialog stands, Escape belongs to the dialog.
  useEffect(() => {
    if (!open || removalOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const base = rangeBase.current
      if (base !== null) {
        rangeBase.current = null
        setSelected(base)
        return
      }
      if (selecting) {
        setSelecting(false)
        setSelected(new Set())
        setAnchorSeq(null)
        return
      }
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, removalOpen, selecting])

  // A complete lone question has nowhere to step or search, so the question
  // controls leave. An incomplete window keeps them mounted even before its
  // first question so load-all remains reachable. Back-to-bottom is
  // independent of all that: it stays as long as there is a scroller to drive.
  const stepping = questions.length > 1 || hasMore || loadingAll
  if (!stepping && onToBottom === undefined) return null

  // What the view is entitled to claim about the rows it shows: `notice` is
  // non-null exactly when the list on screen is not the whole truth, so an
  // empty list is never left to speak for the session by itself.
  const searching = remote.kind === 'searching'
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

  const visibleRemovable = [...new Set(
    rows.map(turnOfRow).filter((turn): turn is number => turn !== undefined && removableTurns.has(turn)),
  )]

  // Cmd/Ctrl adds one row to the picks, Shift adds every removable row between
  // the anchor and this one, and either enters selection mode: the reader
  // never has to find the mode toggle first. A Shift press with no anchor yet,
  // or one whose anchor a query has filtered away, picks the pressed row and
  // becomes the new anchor.
  const pickRow = (row: QuestionSearchResultRow, turn: number, ranged: boolean): void => {
    const range = ranged && anchorSeq !== null ? rangeTurns(anchorSeq, row.seq) : []
    setSelecting(true)
    if (range.length > 0) {
      setSelected(value => new Set([...value, ...range]))
      return
    }
    toggleSelected(turn)
    setAnchorSeq(row.seq)
  }
  const allVisibleSelected = visibleRemovable.length > 0 && visibleRemovable.every(turn => selected.has(turn))
  // The dialog covers the panel, so it names the questions that are leaving
  // rather than making the reader remember a selection it hides.
  const pending = pendingTurns === null ? null : new Set(pendingTurns)
  const pendingQuestions = pending === null
    ? []
    : questions.filter((entry) => {
      const turn = turnOfQuestion.get(entry.key)
      return turn !== undefined && pending.has(turn)
    })

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
          {/* Removal controls: the multi-select toggle, the select-all entry
              that makes a many-question removal one gesture, and the remove
              button that opens the confirmation dialog. */}
          {removableTurns.size > 0 && !removalOpen && (
            <div className={css.questionRemovalBar}>
              <button
                type="button"
                className={css.questionRemovalAction}
                data-active={selecting || undefined}
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting(value => !value)
                  setSelected(new Set())
                  setAnchorSeq(null)
                }}
              >
                {selecting ? t('chat.questions.selectCancel') : t('chat.questions.select')}
              </button>
              {!selecting && (
                <span className={css.questionSelectHint}>{t('chat.questions.selectHint')}</span>
              )}
              {selecting && (
                <>
                  <button
                    type="button"
                    className={css.questionRemovalAction}
                    disabled={visibleRemovable.length === 0}
                    onClick={() => { setSelected(allVisibleSelected ? new Set() : new Set(visibleRemovable)) }}
                  >
                    {allVisibleSelected ? t('chat.questions.selectNone') : t('chat.questions.selectAll')}
                  </button>
                  <button
                    type="button"
                    className={`${css.questionRemovalAction} ${css.questionRemovalPrimary}`}
                    disabled={selected.size === 0}
                    onClick={() => { requestRemoval([...selected].sort((left, right) => left - right)) }}
                  >
                    <IconTrashOutline16 aria-hidden="true" />
                    {t('chat.questions.removeSelected', { count: selected.size })}
                  </button>
                </>
              )}
            </div>
          )}
          {/* The decision is a centered dialog over a mask, not a strip above
              the list: the panel stands at the composer floor, where a strip
              pushes the list it describes out from under the pointer. Enter
              confirms, Escape and the mask cancel. */}
          {pendingTurns !== null && (
            <Modal
              open
              onClose={closeRemoval}
              dismissable={!removing}
              title={t('chat.questions.removeConfirmTitle')}
              closeLabel={t('close')}
              description={t('chat.questions.removeConfirm', { count: pendingTurns.length })}
              footer={(
                <>
                  <Button variant="outline" disabled={removing} onClick={closeRemoval}>
                    {t('chat.questions.removeConfirmNo')}
                  </Button>
                  <Button
                    variant="outline"
                    className={css.questionRemovalDanger}
                    disabled={removing}
                    aria-busy={removing || undefined}
                    autoFocus
                    onClick={() => { confirmRemoval(pendingTurns) }}
                  >
                    {removing ? t('chat.questions.removing') : t('chat.questions.removeConfirmYes')}
                  </Button>
                </>
              )}
            >
              <ul className={css.questionRemovalList}>
                {pendingQuestions.map(entry => <li key={entry.key}>{entry.text}</li>)}
              </ul>
              <p className={css.questionRemovalHint}>{t('chat.questions.removeConfirmHint')}</p>
            </Modal>
          )}
          {failureMessage !== null && (
            <Modal
              open
              onClose={closeRemoval}
              title={t('chat.questions.removeConfirmTitle')}
              closeLabel={t('close')}
              footer={<Button variant="outline" onClick={closeRemoval}>{t('close')}</Button>}
            >
              <p className={css.questionRemovalFailure} role="alert">
                {t('chat.questions.removeFailed', { message: failureMessage })}
              </p>
            </Modal>
          )}
          <div
            className={css.questionList}
            aria-busy={searching || undefined}
            // The pointer left every row, so no row is the range's moving end.
            onPointerLeave={() => { setHoverSeq(null) }}
          >
            {rows.map((row) => {
              const turn = turnOfRow(row)
              const removed = turn !== undefined && removedTurns.has(turn)
              const removableTurn = turn !== undefined && removableTurns.has(turn) ? turn : undefined
              const removable = removableTurn !== undefined
              const checked = turn !== undefined && selected.has(turn)
              const navigate = (): void => {
                if (row.index === undefined) onSelectSeq(row.seq)
                else onSelect(row.index)
              }
              return (
                <div
                  key={row.seq}
                  className={css.questionRow}
                  data-current={row.index === current || undefined}
                  data-removed={removed || undefined}
                  data-selected={checked || undefined}
                  // pointerover, not pointerenter: it bubbles from the row's
                  // own children, so crossing the trash entry keeps the row
                  // under the pointer as the range's moving end.
                  onPointerOver={() => { setHoverSeq(row.seq) }}
                >
                  <button
                    type="button"
                    className={css.questionRowMain}
                    role={selecting ? 'checkbox' : undefined}
                    aria-checked={selecting ? checked : undefined}
                    disabled={selecting && !removable}
                    title={selecting && !removable && !removed ? t('chat.questions.notRemovable') : row.text}
                    onClick={(event) => {
                      const modified = event.metaKey || event.ctrlKey || event.shiftKey
                      if (modified) {
                        // A row that cannot leave model history answers no
                        // pick, so the modifier press does nothing rather
                        // than jumping the transcript under the reader.
                        if (removableTurn !== undefined) pickRow(row, removableTurn, event.shiftKey)
                        return
                      }
                      if (selecting) {
                        if (removableTurn !== undefined) pickRow(row, removableTurn, false)
                        return
                      }
                      navigate()
                    }}
                  >
                    {selecting
                      ? (
                        <span className={css.questionCheck} aria-hidden="true">
                          {checked && <IconCheckOutline14 />}
                        </span>
                      )
                      : <span className={css.questionNumber}>{row.index === undefined ? '·' : row.index + 1}</span>}
                    <span className={css.questionCopy}>
                      <span>{row.text}</span>
                      <span className={css.questionMeta}>
                        <time dateTime={new Date(row.time).toISOString()}>{formatTime(row.time)}</time>
                        {removed && <span className={css.questionRemovedBadge}>{t('chat.questions.removed')}</span>}
                      </span>
                    </span>
                  </button>
                  {!selecting && removableTurn !== undefined && (
                    <button
                      type="button"
                      className={css.questionRowRemove}
                      disabled={removing}
                      aria-label={t('chat.questions.removeOne')}
                      title={t('chat.questions.removeOne')}
                      onClick={() => { requestRemoval([removableTurn]) }}
                    >
                      <IconTrashOutline16 />
                    </button>
                  )}
                </div>
              )
            })}
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
