// SessionFilesRail: navigation and status, not a reading surface. It lists the
// files this session changed (oldest first, so the newest sits at the bottom)
// and, while the agent runs, what it is reading; selecting a file reveals that
// file's changes in the transcript, where the full column width exists. The
// diffs deliberately do not render here: at this width two code columns are
// unreadable, and a second, narrower rendering of the same content is a second
// thing to keep in step.

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconLoadingOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionFilesRailState } from './rail-store.ts'
import type { SessionTreeState } from './tree-controller.ts'
import { mergeTreeChanges } from './tree-files.ts'
import { basename, defaultSelection, labelBudget, sessionFilesOf, truncateHead } from './session-files.ts'
import type { NS } from './locales.ts'
import css from './SessionFilesRail.module.css'

/** Rail preference plus the operations the plugin body owns. */
export interface SessionFilesRailInjected {
  hooks: {
    rail: ObservableSnapshot<SessionFilesRailState>
    /** What the descendant sessions of this session changed. */
    tree: ObservableSnapshot<SessionTreeState>
  }
  /** Adopt a dragged width; the controller clamps it. */
  setWidth: (px: number) => void
  /** Read the first level of finished descendants, as opening the panel does. */
  loadTree: () => void
  /** Page in this session's remaining history and recurse the whole descendant tree. */
  loadAll: () => void
  /** Bring one file's recorded changes into view in the transcript. */
  reveal: (path: string) => void
}

/** Full props for the session file rail. */
export type SessionFilesRailProps =
  PropsRuntime<'conversation.session.rail'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionFilesRailInjected>

/**
 * Render the file rail.
 * @param props - session runtime, rail preference, rail operations, and localized copy.
 * @returns the rail, or null while the reader keeps it closed.
 */
export function SessionFilesRail({
  sessionId, useSession, useSessions, useRail, useTree, setWidth, loadTree, loadAll, reveal, t,
}: SessionFilesRailProps) {
  // Descendants are read, not streamed: `events.mux` is one aggregated stream
  // the runtime owns exclusively, and the signal worth reacting to is not a
  // child's every step but its last one. The catalog mirror already carries
  // that, so a drop in running children re-reads the tree.
  const runningChildren = useSessions(state => (
    (state.subagentsByParent[sessionId]?.entries ?? [])
      .filter(entry => entry.kind === 'child' && entry.activity === 'running').length
  ))
  const open = useRail(state => state.open)
  const width = useRail(state => state.width)
  const local = useSession(snapshot => sessionFilesOf(snapshot))
  const descendants = useTree(state => state.bySession[String(sessionId)])
  const model = mergeTreeChanges(local, descendants?.sources ?? [])
  const [chosen, setChosen] = useState<string | null>(null)
  const [readOpen, setReadOpen] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  // Window listeners rather than pointer capture: the gesture outlives the
  // 6px handle the moment the pointer leaves it, and this keeps the drag
  // branch-free.
  const startDrag = useCallback((event: { clientX: number; preventDefault: () => void }) => {
    event.preventDefault()
    const originX = event.clientX
    const originWidth = widthRef.current
    const move = (moved: PointerEvent): void => { setWidth(originWidth + (moved.clientX - originX)) }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }, [setWidth])

  // A delegated turn contributes nothing to the local snapshot, so the panel
  // asks for the finished first-level descendants as soon as it opens. The
  // controller collapses repeat requests, so a remount costs one no-op.
  useEffect(() => {
    if (open) loadTree()
  }, [loadTree, open, runningChildren, sessionId])

  if (!open) return null

  const selected = chosen ?? defaultSelection(model)
  const partial = model.hasMore || descendants?.partial === true
  const budget = labelBudget(width)
  return (
    <aside className={css.rail} style={{ width }} aria-label={t('rail.title')}>
      <div className={css.scroll}>
        <div className={css.section}>{t('rail.changed')}</div>
        {model.changed.length === 0
          ? <p className={css.empty}>{t('rail.empty')}</p>
          : (
            <ul className={css.list}>
              {model.changed.map(entry => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={clsx(css.file, entry.path === selected && css.selected)}
                    title={entry.path}
                    aria-current={entry.path === selected}
                    aria-label={t('rail.select', { name: entry.path })}
                    onClick={() => { setChosen(entry.path); reveal(entry.path) }}
                  >
                    <span className={css.name}>{truncateHead(basename(entry.path), budget)}</span>
                    {entry.writing && (
                      <IconLoadingOutline16
                        size={12}
                        className={css.spinner}
                        aria-label={t('rail.writing', { name: entry.path })}
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        {partial && (
          <div className={css.partial}>
            <span>{t('rail.partial')}</span>
            <button type="button" className={css.loadAll} onClick={loadAll}>{t('rail.loadAll')}</button>
          </div>
        )}
        {model.read.length > 0 && (
          <>
            <button
              type="button"
              className={css.readToggle}
              aria-expanded={readOpen}
              onClick={() => { setReadOpen(value => !value) }}
            >
              {readOpen ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
              <span>
                {model.read.length === 1
                  ? t('rail.readOne')
                  : t('rail.read', { count: String(model.read.length) })}
              </span>
            </button>
            {readOpen && (
              <ul className={css.list}>
                {model.read.map(path => (
                  <li key={path}>
                    <span className={css.read} title={path}>{truncateHead(basename(path), budget)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div
        className={css.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('rail.resize')}
        onPointerDown={startDrag}
      />
    </aside>
  )
}
