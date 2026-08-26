// ProducedFiles: the produced-file row a finished turn ends with. The paths
// come pre-matched by the turn-tail chain from the mutation tools'
// follow-along locations, never from the closing prose. Clicking one goes
// through the same openFile the tool rows use — the Host's own opener, on the
// Host machine.

import { useLayoutEffect, useRef, useState } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { hasPriorContent, SideBySideDiff } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatFileDiffExpansion, ChatFileDiffSegment, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** At most six chips compete for the one-line summary; every other path stays counted. */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  /**
   * This session's recorded change to one path, from the optional
   * `chatFileDiffs` provider. An empty list means nothing to expand — either
   * the provider is composed out or the session recorded no hunks for the
   * path — and the chip keeps opening the file instead.
   */
  fileDiffs: (path: string) => readonly ChatFileDiffSegment[]
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
    /**
     * How much of this turn opens without being asked, from the same optional
     * provider. Reactive, so changing the preference reaches a transcript
     * already on screen.
     */
    diffExpansion: ObservableSnapshot<ChatFileDiffExpansion>
  }
}

/**
 * Whether one path opens without being asked.
 * @param expansion - the reader's preference.
 * @param changedCount - how many files this turn changed.
 * @returns the default open state for every path of this turn.
 */
export function expandsByDefault(expansion: ChatFileDiffExpansion, changedCount: number): boolean {
  if (expansion === 'all') return true
  return expansion === 'single' && changedCount === 1
}

/** Matched paths plus the opener, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as openable chips.
 * @param props - selector-matched paths, the chat view's file opener, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({
  matched: paths, openFile, isLoopback, fileDiffs, useHostDescription, useDiffExpansion, t,
}: ProducedFilesProps) {
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const limit = Math.min(paths.length, SHOWN_LIMIT)
  const [shownCount, setShownCount] = useState(limit)
  const expansion = useDiffExpansion(value => value)
  // Only the reader's own toggles are stored. Everything else is derived from
  // the live preference, so changing it in Settings reaches turns already on
  // screen without disturbing a file the reader opened or closed by hand.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  // A create stays closed whatever the mode: its left column is all padding, so
  // opening it spends screens on a wall with no comparison in it.
  const isOpen = (path: string): boolean =>
    toggled.get(path)
    ?? (expandsByDefault(expansion, paths.length) && hasPriorContent(fileDiffs(path)))
  const opened = paths
    .filter(path => isOpen(path))
    .map(path => ({ path, segments: fileDiffs(path) }))
    .filter(entry => entry.segments.length > 0)
  const rowRef = useRef<HTMLDivElement>(null)
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  const moreProbe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    const remainderProbe = moreProbe.current
    /* v8 ignore next -- React attaches both refs before the layout effect runs. */
    if (row === null || remainderProbe === null) return
    const measure = (): void => {
      const styles = getComputedStyle(row)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      // React attaches every still-mounted callback ref before layout effects run.
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  const visibleCount = Math.min(shownCount, limit)
  const shown = paths.slice(0, visibleCount)
  const hidden = paths.length - shown.length
  return (
    <div className={css.root}>
      <span className={css.label}>{t('produced.label')}</span>
      <div ref={rowRef} className={css.row} data-produced-files-row>
        {shown.map(path => (
          <button
            key={path}
            type="button"
            className={css.file}
            // The full path is the disambiguator when two turns produce files
            // that share a basename; the chip itself stays short.
            title={path}
            aria-expanded={isOpen(path)}
            aria-label={t('produced.open', { name: path })}
            // One control, two outcomes, decided by what exists: a recorded
            // change expands here, and a file with none keeps the opener it
            // has always had rather than becoming a dead click.
            onClick={() => {
              if (fileDiffs(path).length === 0) { openFile(path); return }
              setToggled((current) => {
                const next = new Map(current)
                next.set(path, !isOpen(path))
                return next
              })
            }}
          >
            {basename(path)}
          </button>
        ))}
        {hidden > 0 && <span className={css.more}>{moreLabel(t, hidden)}</span>}
      </div>
      {hidden > 0 && canOpenPath && (
        <button type="button" className={css.showFolder} onClick={() => { openFile('.') }}>
          {t('produced.showInFolder')}
        </button>
      )}
      {opened.length > 0 && (
        <div className={css.diff}>
          {opened.map(entry => (
            <div key={entry.path}>
              <div className={css.diffHeader}>
                {/* Its own copy, not the chip's: two controls with one accessible
                    name and different outcomes is a defect, not a duplication. */}
                <button
                  type="button"
                  className={css.openFile}
                  onClick={() => { openFile(entry.path) }}
                >
                  {t('produced.openInEditor', { name: basename(entry.path) })}
                </button>
              </div>
              <SideBySideDiff path={entry.path} segments={entry.segments} />
            </div>
          ))}
        </div>
      )}
      <div className={css.measure} aria-hidden="true">
        {paths.slice(0, limit).map((path, index) => (
          <button
            key={path}
            ref={(node) => { chipProbes.current[index] = node }}
            type="button"
            tabIndex={-1}
            className={`${css.file} ${css.probe}`}
          >
            {basename(path)}
          </button>
        ))}
        <span ref={moreProbe} className={`${css.more} ${css.probe}`} />
      </div>
    </div>
  )
}
