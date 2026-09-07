import { useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { hasPriorContent, LinkIcon, SideBySideDiff, classifyLinkPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatFileDiffExpansion, ChatFileDiffSegment, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Maximum number of file chips rendered before the remainder counter. */
const SHOWN_LIMIT = 6

/** Registration-side facts about this Session's recorded file changes. */
export interface ProducedFilesInjected {
  /** Return this Session's recorded diff segments for one exact path. */
  fileDiffs(path: string): readonly ChatFileDiffSegment[]
  hooks: {
    /** Reader preference controlling which inline file diffs open initially. */
    diffExpansion: ObservableSnapshot<ChatFileDiffExpansion>
  }
}

/**
 * Decide whether one Turn's file diffs open before any manual toggle.
 * @param expansion - reader preference.
 * @param changedCount - files changed by the Turn.
 * @returns whether its changed files should start open.
 */
export function expandsByDefault(expansion: ChatFileDiffExpansion, changedCount: number): boolean {
  if (expansion === 'all') return true
  return expansion === 'single' && changedCount === 1
}

/** Matched paths plus the opener, locale, and injected diff facts. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as chips. A chip with recorded hunks
 * toggles an inline before/after comparison whose header opens the file
 * through the owner's `openFile`; a chip without hunks opens the file directly.
 * @param props - selector-matched paths, the chat view's file opener, the
 *   injected diff facts, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({ matched: paths, openFile, fileDiffs, useDiffExpansion, t }: ProducedFilesProps) {
  const shown = paths.slice(0, SHOWN_LIMIT)
  const expansion = useDiffExpansion(value => value)
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const isOpen = (path: string): boolean => toggled.get(path)
    ?? (expandsByDefault(expansion, paths.length) && hasPriorContent(fileDiffs(path)))
  const opened = paths
    .filter(path => isOpen(path))
    .map(path => ({ path, segments: fileDiffs(path) }))
    .filter(entry => entry.segments.length > 0)
  return (
    <div className={css.root}>
      <span className={css.label}>{t('produced.label')}</span>
      <div className={css.lane}>
        <div className={css.row} data-produced-files-row>
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
              onClick={() => {
                if (fileDiffs(path).length === 0) {
                  openFile(path)
                  return
                }
                setToggled((current) => {
                  const next = new Map(current)
                  next.set(path, !isOpen(path))
                  return next
                })
              }}
            >
              <LinkIcon kind={classifyLinkPath(path)} className={css.fileIcon} />
              <span className={css.fileName}>{basename(path)}</span>
            </button>
          ))}
          {shown.map((_, index) => {
            const shownCount = index + 1
            const remainder = paths.length - shownCount
            if (remainder <= 0) return null
            return (
              <span key={shownCount} className={css.more} data-shown={shownCount}>
                {moreLabel(t, remainder)}
              </span>
            )
          })}
        </div>
      </div>
      {opened.length > 0 && (
        <div className={css.diff}>
          {opened.map(entry => (
            <div key={entry.path}>
              <div className={css.diffHeader}>
                <button
                  type="button"
                  className={css.openFile}
                  onClick={() => { openFile(entry.path) }}
                >
                  {t('produced.openInSidebar', { name: basename(entry.path) })}
                </button>
              </div>
              <SideBySideDiff path={entry.path} segments={entry.segments} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
