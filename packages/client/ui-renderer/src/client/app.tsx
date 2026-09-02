/**
 * Real-UI assembly closure. The whole layout tree hangs from the built-in
 * `root` slot, which is the only ctx-level slot render in the application.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from './bind.ts'
import { DocumentTitle, type DocumentBadge, type DocumentTitleStatus } from './DocumentTitle.tsx'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Ambient run state for the browser title.
 *
 * A reader who starts long work and switches tabs has no way back to the
 * result except returning to look. `done` is therefore latched rather than
 * momentary: the last run finishing while the tab is hidden is exactly the
 * event they missed, and the mark has to survive until they come back. It
 * clears on the visit that delivers it, because by then they can see the
 * transcript itself.
 * @param running - how many sessions are running right now.
 * @returns the mark to show, or undefined while idle and already seen.
 */
function useRunStatus(running: number): DocumentTitleStatus | undefined {
  const [finishedAway, setFinishedAway] = useState(false)
  const previous = useRef(running)
  useEffect(() => {
    if (previous.current > 0 && running === 0 && document.hidden) setFinishedAway(true)
    previous.current = running
  }, [running])
  useEffect(() => {
    const onVisibility = (): void => {
      if (!document.hidden) setFinishedAway(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  if (finishedAway) return 'done'
  return running > 0 ? 'running' : undefined
}

/** Inputs available after the UI renderer's inject set activates. */
export interface AssemblyDeps {
  /** Client context carrying the slots and sessions services. */
  ctx: Context
  /** The browser-title count seat plugins report into. */
  badge: DocumentBadge
}

/**
 * Build the assembled application factory.
 * @param deps - Active UI-renderer dependencies.
 * @returns Factory producing the application React tree.
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx, badge } = deps
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('ui renderer: sessions service unavailable')
  const useSessions = bindSnapshotSelector(sessions.list)
  const useBadge = bindSnapshotSelector(badge)
  const SessionDocumentTitle = (): ReactNode => {
    const count = useBadge(value => value)
    const title = useSessions((state) => {
      const id = state.current
      return id === undefined ? undefined : state.byId[id]?.title
    })
    // Every session, not only the selected one: the reader who leaves work
    // running usually left several, and the tab has to speak for all of them.
    const running = useSessions(state => state.ids.filter(id => state.byId[id]?.running === true).length)
    const status = useRunStatus(running)
    return (
      <DocumentTitle
        {...title === undefined ? {} : { title }}
        {...status === undefined ? {} : { status }}
        badge={count}
      />
    )
  }
  return () => (
    <>
      <SessionDocumentTitle />
      {ctx.slots.renderSlot('root', {})}
    </>
  )
}
