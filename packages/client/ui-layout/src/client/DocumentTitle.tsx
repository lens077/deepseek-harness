import { useEffect, useRef, useState } from 'react'

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /** Build-configured or localized product title. */
  productTitle: string
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
export function DocumentTitle({ title, productTitle, running = 0, badge = 0 }: DocumentTitleProps): null {
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
    const label = title === undefined ? productTitle : `${title} — ${productTitle}`
    document.title = `${count}${status}${label}`
    return () => { document.title = productTitle }
  }, [badge, productTitle, status, title])
  return null
}
