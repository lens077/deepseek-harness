/** Browser title selection follows the active main panel without subscribing the frame. */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Props for the browser title projection. */
export type DocumentTitleProps = Pick<PropsRuntime<'root'>, 'useSessions' | 'usePanelInfo'> & {
  /** Build-configured or localized product title. */
  productTitle: string
  /** Current session title supplied by the frame when available. */
  title?: string
  /** Number of Sessions still running across the application. */
  running?: number
  /** Number of inbox entries requiring attention. */
  badge?: number
}

/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ useSessions, usePanelInfo, title, productTitle, running = 0, badge = 0 }: DocumentTitleProps): null {
  const showSessionTitle = usePanelInfo(info => info.activePanelId === null)
  const sessionTitle = useSessions((state) => {
    const current = state.current
    return !showSessionTitle || current === undefined ? undefined : state.byId[current]?.title
  })
  const selectedTitle = showSessionTitle ? (title ?? sessionTitle) : undefined
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
  const status = finishedAway ? '✓ ' : running > 0 ? '● ' : ''
  useEffect(() => {
    const count = badge > 0 ? `(${badge}) ` : ''
    const label = selectedTitle === undefined ? productTitle : `${selectedTitle} — ${productTitle}`
    document.title = `${count}${status}${label}`
    return () => { document.title = productTitle }
  }, [badge, productTitle, selectedTitle, status])
  return null
}
