import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { writeClipboard } from './clipboard.ts'
import { usePointerGrace } from './pointer-grace.ts'
import css from './HoverCard.module.css'

/** Viewport pointer position in CSS pixels. */
interface Point {
  x: number
  y: number
}

/** Whether a viewport point lies inside a rect, edges inclusive. */
function inRect(rect: DOMRect, point: Point): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

/**
 * Render an anchor with a hover-triggered preview card. The card opens only
 * while the pointer still rests on the anchor when the dwell elapses, and
 * closes a grace after the pointer is last seen outside both the anchor and
 * the card — by boundary event, by pointer motion elsewhere, or by the anchor
 * scrolling away beneath a resting pointer — or at once when the window
 * loses focus.
 * @param props.anchor - the hover target (rendered in place inside a wrapper span).
 * @param props.content - card content; the pointer may rest on it, so it is
 * readable and selectable, but it carries no dismissal affordance of its own.
 * @param props.openDelayMs - hover dwell before the card shows (default 500).
 * @param props.disabled - suppress opening; turning true closes an open card.
 * @param props.copyText - optional primary value copied by activation and
 * included in the card's accessible name.
 * @param props.copyLabel - localized accessible activation-label prefix.
 * @param props.copiedLabel - localized visible success label.
 * @returns anchor wrapper with the conditional portaled card.
 */
export function HoverCard({
  anchor, content, openDelayMs = 500, disabled = false,
  copyText, copyLabel, copiedLabel,
}: {
  anchor: ReactNode
  content: ReactNode
  openDelayMs?: number
  disabled?: boolean
  copyText?: string | undefined
  copyLabel: string
  copiedLabel: string
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyHeightRef = useRef<number | null>(null)
  const copyEpochRef = useRef(0)
  const copyingRef = useRef(false)
  const mountedRef = useRef(true)
  // Last known pointer position. The wrapper's own pointer events feed it
  // while closed (the first pointerenter writes it before any read), the
  // document watcher while open.
  const pointerRef = useRef<Point>({ x: 0, y: 0 })
  // A departure close is pending; arming once per departure keeps pointer
  // motion outside the card from deferring the close indefinitely.
  const awayRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [copied, setCopied] = useState(false)

  const clearCopied = useCallback(() => {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
    copyHeightRef.current = null
    setCopied(false)
  }, [])

  const close = useCallback(() => {
    copyEpochRef.current += 1
    awayRef.current = false
    clearCopied()
    setOpen(false)
  }, [clearCopied])

  const { arm, cancel } = usePointerGrace(close)
  const armClose = useCallback(() => {
    if (awayRef.current) return
    awayRef.current = true
    arm()
  }, [arm])
  const cancelClose = useCallback(() => {
    awayRef.current = false
    cancel()
  }, [cancel])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // Owner disabling mid-hover (menu opened, drag started) closes immediately.
  useEffect(() => {
    if (!disabled) return
    clearTimer()
    cancelClose()
    close()
  }, [disabled, cancelClose, close])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      copyEpochRef.current += 1
      clearTimer()
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
    }
  }, [])

  // Fixed-position from the anchor rect before paint; track the anchor while
  // open (capture-phase scroll catches nested panes), as in Menu portal mode.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const wrapper = rootRef.current
      /* v8 ignore next -- the ref is attached before the layout effect runs and the listeners die with it. */
      if (wrapper === null) return
      const r = wrapper.getBoundingClientRect()
      const h = cardRef.current?.offsetHeight ?? 0
      const top = r.top + h > window.innerHeight - 8 ? window.innerHeight - h - 8 : r.top
      setPos({ left: r.right + 8, top })
    }
    // A resting pointer sees no boundary event when the anchor scrolls away
    // beneath it (Chromium defers hover updates until scrolling ends), so
    // the rest position decides against the moved anchor and card rects.
    const track = () => {
      place()
      const wrapper = rootRef.current
      const card = cardRef.current
      /* v8 ignore next -- both are mounted before the listeners attach and die with them. */
      if (wrapper === null || card === null) return
      const point = pointerRef.current
      if (inRect(wrapper.getBoundingClientRect(), point) || inRect(card.getBoundingClientRect(), point)) cancelClose()
      else armClose()
    }
    place()
    window.addEventListener('scroll', track, true)
    window.addEventListener('resize', track)
    return () => {
      window.removeEventListener('scroll', track, true)
      window.removeEventListener('resize', track)
    }
  }, [open, armClose, cancelClose])

  // Boundary events alone strand the card whenever the anchor parts from the
  // pointer without the pointer crossing its edge: the row reorders under a
  // resting pointer, the sidebar collapses, or focus moves to another window.
  // While open, every pointer move is checked against the anchor and the
  // card, and losing window focus closes outright.
  useEffect(() => {
    if (!open) return
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
      const path = e.composedPath()
      if (path.some(node => node === rootRef.current || node === cardRef.current)) cancelClose()
      else armClose()
    }
    const closeNow = () => {
      cancelClose()
      close()
    }
    document.addEventListener('pointermove', onMove, true)
    window.addEventListener('blur', closeNow)
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('blur', closeNow)
    }
  }, [open, armClose, cancelClose, close])

  // The first placement ran before the card mounted (height read 0): once the
  // card's real height is measurable, correct the bottom-edge clamp. The
  // correction converges — a clamped top satisfies the guard, so it runs once.
  useLayoutEffect(() => {
    if (!open || pos === null) return
    /* v8 ignore next -- the card is mounted whenever pos is set, so the ref is attached here. */
    const h = cardRef.current?.offsetHeight ?? 0
    if (pos.top + h > window.innerHeight - 8) {
      setPos({ left: pos.left, top: window.innerHeight - h - 8 })
    }
  }, [open, pos])

  const copy = async (text: string): Promise<void> => {
    if (copied || copyingRef.current) return
    copyingRef.current = true
    const copyEpoch = copyEpochRef.current
    const accepted = await writeClipboard(text)
    copyingRef.current = false
    const card = cardRef.current
    if (!accepted || !mountedRef.current || copyEpoch !== copyEpochRef.current || card === null) return
    const height = card.offsetHeight
    copyHeightRef.current = height > 0 ? height : null
    setCopied(true)
    copyTimerRef.current = setTimeout(clearCopied, 1000)
  }

  const copyable = copyText !== undefined
  const card = open && pos !== null && (
    <div
      ref={cardRef}
      className={`${css.card}${copyable ? ` ${css.copyable}` : ''}${copied ? ` ${css.feedback}` : ''}`}
      style={{ ...pos, minHeight: copied && copyHeightRef.current !== null ? copyHeightRef.current : undefined }}
      role={copyable ? 'button' : undefined}
      tabIndex={copyable ? 0 : undefined}
      aria-label={copyable ? `${copyLabel}: ${copyText}` : undefined}
      onClick={copyable
        ? (e) => {
          const selection = window.getSelection()
          if (selection !== null && !selection.isCollapsed) {
            for (let i = 0; i < selection.rangeCount; i += 1) {
              if (selection.getRangeAt(i).intersectsNode(e.currentTarget)) return
            }
          }
          void copy(copyText)
        }
        : undefined}
      onKeyDown={copyable
        ? (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          void copy(copyText)
        }
        : undefined}
    >
      {copied ? <span className={css.copied} aria-hidden="true">{copiedLabel}</span> : content}
    </div>
  )

  return (
    <span
      ref={rootRef}
      className={css.root}
      onPointerEnter={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
        if (disabled) return
        // Coming back inside during the grace (the gap, or the card itself)
        // keeps the current card rather than restarting the dwell.
        cancelClose()
        if (open) return
        clearTimer()
        const wrapper = e.currentTarget
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          // The anchor may have scrolled out from under a resting pointer
          // during the dwell; a card beside a row nobody is pointing at
          // would open stranded.
          if (!inRect(wrapper.getBoundingClientRect(), pointerRef.current)) return
          setOpen(true)
        }, openDelayMs)
      }}
      onPointerMove={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerLeave={() => {
        clearTimer()
        // Leaving a closed card schedules a no-op close; only arm while
        // open, matching Menu's shape.
        if (open) armClose()
      }}
      // A press inside the anchor (row click, menu trigger) dismisses the
      // card immediately, without waiting for the owner to flip `disabled`.
      // Capture presses reach this handler from the card too — it is a React
      // child of the wrapper — but a press there starts a selection, so the
      // card must stay mounted under it (and the browser's click with it).
      onPointerDownCapture={(e) => {
        if (cardRef.current?.contains(e.target as Node)) return
        clearTimer()
        cancelClose()
        close()
      }}
    >
      {anchor}
      {open && copyable && <span className={css.status} role="status">{copied ? copiedLabel : ''}</span>}
      {card !== false && createPortal(card, document.body)}
    </span>
  )
}
