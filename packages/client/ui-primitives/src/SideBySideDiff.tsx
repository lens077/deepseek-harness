// SideBySideDiff: a file's recorded changes as two aligned columns — the prior
// content on the left, the content after the change on the right. Where
// DiffBlock stacks the removed block above the added one for a single call
// inside the message flow, this surface is for comparing the two sides of one
// file across every change a session made to it, so corresponding lines must
// sit level: each segment's sides are paired line by line and the shorter side
// is padded, and the two columns scroll horizontally in lockstep because
// independent scrolling would destroy that alignment. Output never wraps — an
// aligned source line keeps its indentation. Colors resolve through --dsw-*
// tokens; geometry mirrors DiffBlock.

import { useCallback, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { diffLines } from 'diff'
import css from './SideBySideDiff.module.css'

/** One recorded change to the file, with the provenance drawn above it. */
export interface SideBySideSegment {
  /**
   * Where this change came from, drawn as the segment's header
   * (`Turn 3 · Edit`). Omitted where the surface is already one call's own row
   * and the provenance would only repeat what the row says.
   */
  label?: string | undefined
  /** Prior content, or `null` for a create (nothing on the left). */
  oldText: string | null
  /** Content after the change. */
  newText: string
}

export interface SideBySideDiffProps {
  /** The changed file's path, drawn as the block header. */
  path: string
  /** One entry per recorded change, in the order the changes happened; empty renders nothing. */
  segments: readonly SideBySideSegment[]
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * One rendered row of a segment. `null` on a side is padding — that side has no
 * line here — which is what keeps the two columns level.
 */
export interface PairedRow {
  /** `same` for context, `change` for a replaced line, `del`/`add` for one-sided lines. */
  kind: 'same' | 'change' | 'del' | 'add'
  left: string | null
  right: string | null
}

/**
 * Whether these segments have a prior side worth comparing against.
 *
 * A create records `oldText: null` for every hunk, so its left column is
 * nothing but padding and its right column is the whole file — a wall with
 * no comparison in it. Surfaces that open a diff without being asked use this
 * to leave those closed.
 * @param segments - the segments a surface is about to draw.
 * @returns true when at least one segment has prior content.
 */
export function hasPriorContent(segments: readonly { oldText: string | null }[]): boolean {
  return segments.some(segment => segment.oldText !== null)
}

/**
 * Split one side's text into content lines. Empty text is zero lines and a
 * single trailing newline is a terminator rather than an extra blank line — the
 * rule {@link DiffBlock} applies, so the two diff surfaces agree on what a
 * line is. An interior blank line survives.
 * @param text - one side's text, or a diff part's value.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Pair one segment's two sides into level rows.
 *
 * A create (`oldText: null`) is every new line added against an empty left
 * side. Otherwise the sides are re-diffed by line: the hunks this component
 * receives were produced from a unified patch whose line numbers were dropped
 * before the data left the tool, so the correspondence has to be recovered
 * here. A removed run immediately followed by an added run is zipped into
 * `change` rows and the longer run's remainder falls through as one-sided rows,
 * which is what makes an edited line show its before and after on one line of
 * the display.
 * @param oldText - prior content, or null for a create.
 * @param newText - content after the change.
 * @returns the paired rows, in file order.
 */
export function pairDiffLines(oldText: string | null, newText: string): PairedRow[] {
  if (oldText === null) {
    return contentLines(newText).map(line => ({ kind: 'add' as const, left: null, right: line }))
  }
  const rows: PairedRow[] = []
  const parts = diffLines(oldText, newText)
  // Set when a removed run consumed the added run behind it, so that added run
  // is not emitted a second time on its own iteration.
  let consumed = false
  for (const [index, part] of parts.entries()) {
    const lines = contentLines(part.value)
    if (!part.removed && !part.added) {
      for (const line of lines) rows.push({ kind: 'same', left: line, right: line })
      continue
    }
    if (part.added) {
      if (consumed) { consumed = false; continue }
      for (const line of lines) rows.push({ kind: 'add', left: null, right: line })
      continue
    }
    // A removed run: zip it against an immediately following added run so a
    // replaced line reads as one row carrying both sides.
    const next = parts[index + 1]
    const paired = next?.added === true ? contentLines(next.value) : []
    consumed = paired.length > 0
    for (const [row, left] of lines.entries()) {
      const right = paired[row]
      if (right === undefined) rows.push({ kind: 'del', left, right: null })
      else rows.push({ kind: 'change', left, right })
    }
    // Whatever the added run has beyond the removed run's length is pure growth.
    for (const right of paired.slice(lines.length)) {
      rows.push({ kind: 'add', left: null, right })
    }
  }
  return rows
}

/**
 * Mirror one pane's horizontal offset onto the other. The equality check is
 * what stops the loop: assigning `scrollLeft` fires the target's own scroll
 * event, whose mirror-back finds the offsets already equal and stops.
 * @param source - the pane the reader scrolled.
 * @param target - the pane to bring along.
 */
function mirrorScroll(source: HTMLElement | null, target: HTMLElement | null): void {
  /* v8 ignore next -- both refs are attached before any scroll event can fire. */
  if (source === null || target === null) return
  if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft
}

/** One segment's two panes, owning the ref pair their scroll sync needs. */
function SegmentPanes({ rows }: { rows: readonly PairedRow[] }) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const onLeftScroll = useCallback(() => { mirrorScroll(leftRef.current, rightRef.current) }, [])
  const onRightScroll = useCallback(() => { mirrorScroll(rightRef.current, leftRef.current) }, [])

  return (
    <div className={css.panes}>
      <div ref={leftRef} className={css.pane} data-side="old" onScroll={onLeftScroll}>
        {rows.map((row, index) => (
          <div
            key={index}
            className={clsx(css.line, row.left === null ? css.pad : row.kind === 'same' ? css.same : css.del)}
          >
            {row.left ?? ''}
          </div>
        ))}
      </div>
      <div ref={rightRef} className={css.pane} data-side="new" onScroll={onRightScroll}>
        {rows.map((row, index) => (
          <div
            key={index}
            className={clsx(css.line, row.right === null ? css.pad : row.kind === 'same' ? css.same : css.add)}
          >
            {row.right ?? ''}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Render a file's session-accumulated changes as aligned before/after columns.
 * @param props - see {@link SideBySideDiffProps}.
 * @returns the diff element, or null when there is nothing to draw.
 */
export function SideBySideDiff({ path, segments, className }: SideBySideDiffProps) {
  const paired = useMemo(
    () => segments.map(segment => ({ label: segment.label, rows: pairDiffLines(segment.oldText, segment.newText) })),
    [segments],
  )
  if (paired.length === 0) return null

  return (
    <div className={clsx(css.block, className)} data-side-by-side-diff="">
      <div className={css.path}>{path}</div>
      {paired.map((segment, index) => (
        <div key={index} className={css.segment}>
          {segment.label !== undefined && <div className={css.label}>{segment.label}</div>}
          <SegmentPanes rows={segment.rows} />
        </div>
      ))}
    </div>
  )
}
